import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * A disk-backed cache of image responses, used during capture to answer
 * repeat image requests locally instead of re-fetching them from the origin.
 *
 * The cache key is the full request URL — query string included — so CDN
 * resize variants (`photo.jpg?w=400` vs `photo.jpg?w=800`) are distinct
 * entries. Each entry is a body file plus a JSON sidecar holding the URL and
 * content type; the sidecar is written last, so its presence means the body
 * is complete.
 *
 * Origin fetches for the same URL are coalesced: with parallel contexts all
 * requesting the same hero image at once, only the first goes to the origin
 * and the rest await its result.
 */
class ImageCache {
	/**
	 * @param {string} dir The directory entries are stored in.
	 */
	constructor(dir) {
		this.dir = dir;
		this.inflight = new Map();
		this.hits = 0;
		this.fetches = 0;
	}

	/**
	 * The storage paths for a URL's cache entry.
	 *
	 * @param {string} url The request URL.
	 * @returns {{ bodyPath: string, metaPath: string }} Entry file paths.
	 */
	entryPaths(url) {
		const key = crypto.createHash('sha256').update(url).digest('hex');
		return {
			bodyPath: path.join(this.dir, `${key}.bin`),
			metaPath: path.join(this.dir, `${key}.json`),
		};
	}

	/**
	 * Read a cached entry, or null on a miss.
	 *
	 * A damaged entry (unreadable sidecar, missing body) reads as a miss so
	 * the image is simply re-fetched.
	 *
	 * @param {string} url The request URL.
	 * @returns {Promise<{ status: number, contentType: string|null, body: Buffer }|null>} The entry.
	 */
	async get(url) {
		const { bodyPath, metaPath } = this.entryPaths(url);

		try {
			const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
			const body = await fsp.readFile(bodyPath);
			this.hits++;
			return { status: meta.status, contentType: meta.contentType, body };
		} catch {
			return null;
		}
	}

	/**
	 * Fetch a URL from the origin, caching a successful response.
	 *
	 * Concurrent calls for the same URL share one origin fetch. Only 2xx
	 * responses are stored; errors and redirect leftovers pass through
	 * uncached so a genuinely broken image stays broken in the capture.
	 *
	 * @param {string}   url     The request URL.
	 * @param {Function} fetcher Performs the origin request (e.g. `route.fetch()`).
	 * @returns {Promise<{ status: number, contentType: string|null, body: Buffer }>} The response data.
	 */
	async fetchOnce(url, fetcher) {
		if (this.inflight.has(url)) {
			return this.inflight.get(url);
		}

		const promise = (async () => {
			this.fetches++;
			const response = await fetcher();
			const entry = {
				status: response.status(),
				contentType: response.headers()['content-type'] ?? null,
				body: await response.body(),
			};

			if (response.ok()) {
				await this.put(url, entry);
			}

			return entry;
		})();

		this.inflight.set(url, promise);

		try {
			return await promise;
		} finally {
			this.inflight.delete(url);
		}
	}

	/**
	 * Write an entry to disk. A write failure (disk full, permissions) is
	 * not fatal — the response still serves this request, just uncached.
	 *
	 * @param {string} url   The request URL.
	 * @param {object} entry The entry ({ status, contentType, body }).
	 */
	async put(url, entry) {
		const { bodyPath, metaPath } = this.entryPaths(url);

		try {
			await fsp.writeFile(bodyPath, entry.body);
			await fsp.writeFile(
				metaPath,
				JSON.stringify({
					url,
					status: entry.status,
					contentType: entry.contentType,
				})
			);
		} catch (error) {
			console.warn(`⚠️  Could not cache image ${url}: ${error.message}`);
		}
	}

	/**
	 * Counters for the run summary.
	 *
	 * @returns {{ hits: number, fetches: number }} Cache hits and origin fetches.
	 */
	stats() {
		return { hits: this.hits, fetches: this.fetches };
	}
}

/**
 * Open the image cache directory, optionally clearing existing entries.
 *
 * The default (non-persistent) cache is cleared at the start of every run so
 * a stale cached image can never mask a real change on the origin between a
 * control run and a compare run.
 *
 * @param {string}  dir             The cache directory.
 * @param {object}  [options]       Open options.
 * @param {boolean} [options.clear] Remove existing entries first.
 * @returns {ImageCache} The opened cache.
 */
export function openImageCache(dir, { clear = false } = {}) {
	if (clear) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	fs.mkdirSync(dir, { recursive: true });

	return new ImageCache(dir);
}
