import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { filterTargets, DEFAULT_TIMEOUTS } from './config.mjs';

/**
 * Whether a host is a local development host, for which self-signed/invalid
 * TLS certificates are expected and certificate errors are ignored by default.
 *
 * @param {string|null} host - The hostname (no port).
 * @returns {boolean} True for localhost/loopback and .test/.local(.localhost) hosts.
 */
export function isLocalHost(host) {
	if (!host) {
		return false;
	}

	const name = host.replace(/:\d+$/, '').toLowerCase();
	return (
		name === 'localhost' ||
		name === '127.0.0.1' ||
		name === '::1' ||
		name.endsWith('.test') ||
		name.endsWith('.local') ||
		name.endsWith('.localhost')
	);
}

/**
 * Targets whose absolute-URL path points off the configured domain.
 *
 * A `paths` value that is a full URL bypasses `domain`/`--domain` and the
 * browser navigates to it as-is. That is a documented convenience, but
 * surfacing it makes off-domain (and potentially internal-network) capture a
 * conscious choice rather than a silent one.
 *
 * @param {Array}       targets - The targets to inspect.
 * @param {string|null} domain  - The configured domain origin.
 * @returns {Array} Targets pointing at a different host.
 */
export function offDomainTargets(targets, domain) {
	if (!domain) {
		return [];
	}

	let host;
	try {
		host = new URL(domain).hostname;
	} catch {
		return [];
	}

	return targets.filter((target) => {
		try {
			return new URL(target.url).hostname !== host;
		} catch {
			return false;
		}
	});
}

/**
 * Whether a URL's host is covered by the configured block list.
 *
 * An entry matches the host itself and all of its subdomains, so
 * "example.org" blocks both "example.org" and "sub.example.org". Non-network
 * URLs (blob:, data:, chrome-extension:) have no hostname and never match.
 *
 * @param {string}   url        - The request URL.
 * @param {string[]} blockHosts - Normalized (lowercase) hostnames.
 * @returns {boolean} True when the request should be blocked.
 */
export function isBlockedHost(url, blockHosts) {
	if (!blockHosts?.length) {
		return false;
	}

	let host;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}

	if (!host) {
		return false;
	}

	return blockHosts.some(
		(entry) => host === entry || host.endsWith(`.${entry}`)
	);
}

/**
 * Scroll the full height of the page and back to the top.
 *
 * Triggers lazy-loaded images and other on-scroll behavior so the screenshot
 * captures the page as a visitor would see it. Steps one viewport at a time
 * because lazy loaders (IntersectionObserver, native loading="lazy") only
 * trigger for content near the viewport — jumping straight to the bottom
 * skips everything in between, and which of those images load becomes a
 * timing race. The height is re-read every step so content that loads and
 * grows the page extends the walk.
 *
 * @param {import('playwright').Page} page - The page to scroll.
 */
async function autoScroll(page) {
	await page.evaluate(async () => {
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		const root = document.scrollingElement || document.documentElement;
		let position = 0;

		// Cap iterations so a page can't loop forever. (e.g. infinite scroll)
		for (let i = 0; i < 500; i++) {
			position += window.innerHeight;
			// 'instant' overrides a site's `scroll-behavior: smooth`, which
			// would otherwise animate each step and outpace this loop.
			window.scrollTo({ top: position, behavior: 'instant' });
			await sleep(50);

			if (position >= root.scrollHeight - window.innerHeight) {
				break;
			}
		}

		window.scrollTo({ top: 0, behavior: 'instant' });
	});
}

/**
 * Wait for every image on the page to finish loading and be ready to paint.
 *
 * The network-idle settle alone is not enough: it only covers requests that
 * have already started, says nothing about decode state, and when it times
 * out on a busy server the capture proceeds silently with whatever images
 * happened to arrive. decode() resolves once an image is loaded and decoded;
 * a broken image rejects, which counts as settled — a missing image is the
 * page's actual state, not something to keep waiting on.
 *
 * @param {import('playwright').Page} page    - The page to wait on.
 * @param {number}                    timeout - Max wait in ms.
 * @returns {Promise<number>} How many images were still loading at timeout.
 */
async function waitForImages(page, timeout) {
	return page.evaluate(async (maxWait) => {
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		// Hidden images are excluded: they cannot paint into the screenshot,
		// and a hidden native-lazy image (e.g. a desktop-only image at a
		// mobile viewport width) never loads at all by design — waiting for
		// it would burn the full timeout and warn about nothing.
		const images = Array.from(document.images).filter((img) =>
			img.checkVisibility ? img.checkVisibility() : true
		);

		await Promise.race([
			Promise.all(images.map((img) => img.decode().catch(() => {}))),
			sleep(maxWait),
		]);

		return images.filter((img) => !img.complete).length;
	}, timeout);
}

/**
 * Group viewports by their device scale factor, preserving order.
 *
 * Playwright's deviceScaleFactor can only be set when a context is created and
 * cannot be changed on a live context, so each distinct DPR needs its own
 * context. Viewports usually share a DPR, so grouping is cheaper than a context
 * per viewport while still letting setViewportSize switch sizes within a group.
 * A viewport without an explicit deviceScaleFactor defaults to 1.
 *
 * @param {Array} viewports - Viewport definitions.
 * @returns {Array<{ deviceScaleFactor: number, viewports: Array }>} Groups in
 *   first-seen DPR order.
 */
export function groupViewportsByScaleFactor(viewports) {
	const groups = new Map();

	for (const viewport of viewports) {
		const deviceScaleFactor = viewport.deviceScaleFactor ?? 1;
		if (!groups.has(deviceScaleFactor)) {
			groups.set(deviceScaleFactor, []);
		}
		groups.get(deviceScaleFactor).push(viewport);
	}

	return [...groups.entries()].map(([deviceScaleFactor, grouped]) => ({
		deviceScaleFactor,
		viewports: grouped,
	}));
}

/**
 * Capture screenshots for a single target across all viewports.
 *
 * Returns the list of slugs that did not capture cleanly so the caller can
 * report them. A degraded capture is still written (best effort) but is
 * recorded as a failure rather than silently treated as success.
 *
 * Viewports are captured one context per device scale factor (see
 * groupViewportsByScaleFactor); within a context the first viewport navigates
 * fresh and the rest reuse the page (reloading unless --skip-reload).
 *
 * @param {import('playwright').Browser} browser   The shared browser.
 * @param {object}                       target    The target ({ key, url }).
 * @param {Array}                        viewports Viewport definitions.
 * @param {object}                       dirs      Output directory paths.
 * @param {object}                       options   Capture options.
 * @returns {Promise<Array<{ slug: string, url: string, reason: string }>>} Failed slugs.
 */
async function captureTarget(browser, target, viewports, dirs, options) {
	const {
		skipReload = false,
		retryCount = 2,
		timeouts = DEFAULT_TIMEOUTS,
		ignoreHTTPSErrors = false,
		blockHosts = [],
	} = options;
	const failures = [];
	let currentSlug = target.key;

	for (const group of groupViewportsByScaleFactor(viewports)) {
		const context = await browser.newContext({
			ignoreHTTPSErrors,
			deviceScaleFactor: group.deviceScaleFactor,
		});

		if (blockHosts.length) {
			await context.route('**/*', (route) => {
				if (isBlockedHost(route.request().url(), blockHosts)) {
					return route.abort('blockedbyclient');
				}
				return route.continue();
			});
		}

		const page = await context.newPage();

		const failedResources = new Set();
		page.on('requestfailed', (request) => {
			// A deliberately blocked host is not a load failure.
			if (isBlockedHost(request.url(), blockHosts)) {
				return;
			}
			const type = request.resourceType();
			if (type === 'stylesheet' || type === 'script') {
				failedResources.add(request.url());
				console.warn(`⚠️  Failed to load ${type}: ${request.url()}`);
			}
		});

		try {
			for (let i = 0; i < group.viewports.length; i++) {
				const viewport = group.viewports[i];
				const slug = `${target.key}-${viewport.name}`;
				currentSlug = slug;

				console.log(`Capturing ${slug}...`);

				await page.setViewportSize({
					width: viewport.width,
					height: viewport.height,
				});

				failedResources.clear();

				let attempts = 0;
				let success = false;

				while (attempts <= retryCount && !success) {
					try {
						if (i === 0 || !skipReload) {
							if (attempts > 0) {
								console.log(`  Retry attempt ${attempts}...`);
								await page.waitForTimeout(1000);
							}

							const gotoOptions = {
								waitUntil: 'networkidle',
								timeout: timeouts.goto,
							};

							if (i === 0 || attempts > 0) {
								await page.goto(target.url, gotoOptions);
							} else {
								await page.reload(gotoOptions);
							}

							if (
								failedResources.size > 0 &&
								attempts < retryCount
							) {
								throw new Error(
									'Critical resources failed to load'
								);
							}
						}
						success = true;
					} catch (error) {
						attempts++;
						if (attempts > retryCount) {
							// Retries exhausted. Screenshot best-effort below, but
							// record the slug as degraded rather than faking success.
							const reason = error.message || String(error);
							console.error(
								`  ⚠️  ${slug} did not load cleanly after ${retryCount + 1} attempts: ${reason}`
							);
							failures.push({ slug, url: target.url, reason });
							success = true;
						}
					}
				}

				await autoScroll(page);
				// A single event-driven settle after scrolling, bounded by the
				// configurable timeout: near-instant on a page that is already
				// quiet, and long enough for lazy assets on a slow one. (The goto
				// above already waited for the initial network idle.)
				await page
					.waitForLoadState('networkidle', {
						timeout: timeouts.settle,
					})
					.catch(() => {
						// Slow/never-idle page; screenshot what we have.
					});

				const pendingImages = await waitForImages(
					page,
					timeouts.settle
				);
				if (pendingImages > 0) {
					console.warn(
						`  ⚠️  ${slug}: ${pendingImages} image(s) were still loading at capture ` +
							'— the screenshot may be missing them. Raise "timeouts.settle" if this persists.'
					);
				}

				const imagePath = path.join(dirs.captures, `${slug}.png`);
				await page.screenshot({ path: imagePath, fullPage: true });

				const htmlPath = path.join(dirs.capturesHtml, `${slug}.html`);
				fs.writeFileSync(htmlPath, await page.content());

				console.log(`✓ Captured ${slug}`);
			}
		} catch (error) {
			// A failure outside the retry loop (e.g. screenshot or HTML write).
			const reason = error.message || String(error);
			console.error(
				`Error capturing ${currentSlug} (${target.url}): ${reason}`
			);
			failures.push({ slug: currentSlug, url: target.url, reason });
		} finally {
			await context.close();
		}
	}

	return failures;
}

/**
 * Decide whether a capture run should exit non-zero.
 *
 * Degraded captures are always reported loudly, but the non-zero exit is
 * opt-in (so existing best-effort/partial workflows keep working) — see the
 * D-004 decision.
 *
 * @param {Array}   failures         The degraded-slug records.
 * @param {boolean} [failOnDegraded] Whether degraded captures fail the run.
 * @returns {boolean} True when the run should signal failure.
 */
export function shouldFailRun(failures, failOnDegraded = false) {
	return Boolean(failOnDegraded) && failures.length > 0;
}

/**
 * Capture screenshots for every configured target.
 *
 * @param {object} config                   The normalized config.
 * @param {object} [options]                Capture options.
 * @param {number} [options.concurrency]    Parallel browser contexts.
 * @param {number} [options.staggerDelay]   Delay (ms) between context starts.
 * @param {boolean}[options.skipReload]     Reuse the page between viewports.
 * @param {boolean}[options.failOnDegraded] Exit non-zero if any capture is degraded.
 * @param {Array}  [options.only]           Limit to these target keys.
 * @returns {Promise<{ failures: Array }>} The degraded-slug records.
 */
export async function capture(config, options = {}) {
	const {
		concurrency = 4,
		staggerDelay = 500,
		skipReload = false,
		failOnDegraded = false,
	} = options;

	fs.mkdirSync(config.dirs.captures, { recursive: true });
	fs.mkdirSync(config.dirs.capturesHtml, { recursive: true });

	const targets = filterTargets(config.targets, options.only);

	const offDomain = offDomainTargets(targets, config.domain);
	if (offDomain.length) {
		console.warn(
			`⚠️  ${offDomain.length} path(s) point off the configured domain and ` +
				`will be captured as-is: ${offDomain.map((target) => target.key).join(', ')}.`
		);
	}

	const totalShots = targets.length * config.viewports.length;
	console.log(`Domain: ${config.domain}`);
	console.log(`Targets: ${targets.length}`);
	console.log(`Viewports per target: ${config.viewports.length}`);
	console.log(`Total screenshots: ${totalShots}`);
	console.log(`Concurrency: ${concurrency} parallel contexts`);
	if (config.blockHosts?.length) {
		console.log(
			`Blocking hosts (and subdomains): ${config.blockHosts.join(', ')}`
		);
	}

	// Ignore TLS certificate errors only for local development hosts (where
	// self-signed certs are normal). For a non-local host, validation stays on
	// unless explicitly opted out with --insecure, and we warn when it does.
	const host = config.domain ? new URL(config.domain).hostname : null;
	const ignoreHTTPSErrors = isLocalHost(host) || Boolean(options.insecure);
	if (options.insecure && host && !isLocalHost(host)) {
		console.warn(
			`⚠️  TLS certificate validation is DISABLED for non-local host ${host} (--insecure). ` +
				'A swapped or expired certificate will be captured without warning.'
		);
	}

	let browser;
	try {
		browser = await chromium.launch(
			ignoreHTTPSErrors ? { args: ['--ignore-certificate-errors'] } : {}
		);
	} catch (error) {
		// The postinstall browser download is best-effort, so surface a missing
		// browser as an actionable message rather than a raw Playwright stack.
		if (/install|executable doesn't exist/i.test(error.message)) {
			throw new Error(
				'Chromium is not installed. Run `npx playwright install chromium` and try again.'
			);
		}
		throw error;
	}

	const failures = [];

	try {
		// A queue-based worker pool: each worker pulls the next target as soon
		// as it finishes, so one slow target never gates the others (unlike a
		// fixed batch). The stagger is applied once per worker at startup to
		// avoid a thundering herd, rather than per-index — so raising the
		// concurrency doesn't add an ever-growing upfront wait.
		const queue = [...targets];
		const poolSize = Math.max(1, Math.min(concurrency, queue.length));

		const runWorker = async (index) => {
			if (staggerDelay > 0 && index > 0) {
				await new Promise((resolve) =>
					setTimeout(resolve, index * staggerDelay)
				);
			}
			while (queue.length) {
				const target = queue.shift();
				const targetFailures = await captureTarget(
					browser,
					target,
					config.viewports,
					config.dirs,
					{
						skipReload,
						timeouts: config.timeouts,
						ignoreHTTPSErrors,
						blockHosts: config.blockHosts ?? [],
					}
				);
				failures.push(...targetFailures);
			}
		};

		await Promise.all(
			Array.from({ length: poolSize }, (_, index) => runWorker(index))
		);
	} finally {
		await browser.close();
	}

	if (failures.length) {
		console.error(
			`\n⚠️  ${failures.length} capture(s) did not load cleanly:`
		);
		failures.forEach((failure) => {
			console.error(`  - ${failure.slug}: ${failure.reason}`);
		});
		console.error(
			'These captures may be blank or show an error page. ' +
				'Review them before running "reglance control".'
		);
		if (shouldFailRun(failures, failOnDegraded)) {
			process.exitCode = 1;
		}
		return { failures };
	}

	console.log('\n✅ Capture complete');
	return { failures: [] };
}
