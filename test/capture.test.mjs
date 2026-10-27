import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
	shouldFailRun,
	isLocalHost,
	offDomainTargets,
	groupViewportsByScaleFactor,
	isBlockedHost,
	pngDimensions,
	browserLaunchOptions,
	browserContextOptions,
	screenshotOptions,
	documentResponse,
} from '../src/capture.mjs';

const FAILURES = [
	{ slug: 'home-desktop', url: 'https://x.test/', reason: 'timeout' },
];

test('shouldFailRun is false when there are no failures', () => {
	assert.equal(shouldFailRun([], true), false);
	assert.equal(shouldFailRun([], false), false);
});

test('shouldFailRun is false for degraded captures without the opt-in flag', () => {
	// Default behavior: report loudly but still exit 0.
	assert.equal(shouldFailRun(FAILURES), false);
	assert.equal(shouldFailRun(FAILURES, false), false);
});

test('shouldFailRun is true for degraded captures with --fail-on-degraded', () => {
	assert.equal(shouldFailRun(FAILURES, true), true);
});

test('isLocalHost recognizes local development hosts', () => {
	assert.equal(isLocalHost('site.test'), true);
	assert.equal(isLocalHost('my.app.local'), true);
	assert.equal(isLocalHost('localhost'), true);
	assert.equal(isLocalHost('localhost:8080'), true);
	assert.equal(isLocalHost('127.0.0.1'), true);
});

test('isLocalHost treats real and missing hosts as non-local', () => {
	assert.equal(isLocalHost('example.com'), false);
	assert.equal(isLocalHost('staging.example.org'), false);
	assert.equal(isLocalHost(null), false);
	assert.equal(isLocalHost(''), false);
});

test('offDomainTargets flags absolute-URL paths on another host', () => {
	const targets = [
		{ key: 'home', url: 'https://site.test/' },
		{ key: 'ext', url: 'https://other.test/page' },
	];
	const off = offDomainTargets(targets, 'https://site.test');
	assert.deepEqual(
		off.map((t) => t.key),
		['ext']
	);
});

test('offDomainTargets returns nothing when all targets match the domain', () => {
	const targets = [{ key: 'home', url: 'https://site.test/' }];
	assert.deepEqual(offDomainTargets(targets, 'https://site.test'), []);
});

test('offDomainTargets returns nothing without a configured domain', () => {
	const targets = [{ key: 'home', url: 'https://site.test/' }];
	assert.deepEqual(offDomainTargets(targets, null), []);
});

test('isBlockedHost matches a listed host exactly', () => {
	assert.equal(
		isBlockedHost('https://captcha.example.com/widget/v0/api.js', [
			'captcha.example.com',
		]),
		true
	);
});

test('isBlockedHost matches subdomains of a listed host', () => {
	assert.equal(
		isBlockedHost('https://sub.example.org/f83b/index.js', ['example.org']),
		true
	);
});

test('isBlockedHost does not match a host that merely ends with an entry', () => {
	// "example.com" must not block "notexample.com".
	assert.equal(
		isBlockedHost('https://notexample.com/x.js', ['example.com']),
		false
	);
});

test('isBlockedHost ignores case in the request host', () => {
	assert.equal(
		isBlockedHost('https://Captcha.Example.com/x', ['captcha.example.com']),
		true
	);
});

test('isBlockedHost leaves unlisted hosts alone', () => {
	assert.equal(
		isBlockedHost('https://site.test/style.css', ['captcha.example.com']),
		false
	);
});

test('isBlockedHost never matches URLs without a hostname', () => {
	const blocked = ['captcha.example.com'];
	assert.equal(isBlockedHost('blob:https://x.test/abc-123', blocked), false);
	assert.equal(isBlockedHost('data:text/plain,hi', blocked), false);
	assert.equal(isBlockedHost('not a url', blocked), false);
});

test('isBlockedHost is false for an empty or missing block list', () => {
	assert.equal(isBlockedHost('https://x.test/', []), false);
	assert.equal(isBlockedHost('https://x.test/', undefined), false);
});

test('groupViewportsByScaleFactor defaults a missing DPR to 1', () => {
	const groups = groupViewportsByScaleFactor([
		{ name: 'desktop', width: 1920, height: 1080 },
	]);
	assert.deepEqual(groups, [
		{
			deviceScaleFactor: 1,
			viewports: [{ name: 'desktop', width: 1920, height: 1080 }],
		},
	]);
});

test('groupViewportsByScaleFactor groups viewports that share a DPR', () => {
	const groups = groupViewportsByScaleFactor([
		{ name: 'desktop', width: 1920, height: 1080 },
		{ name: 'desktop-2x', width: 1920, height: 1080, deviceScaleFactor: 2 },
		{ name: 'mobile', width: 390, height: 844 },
		{ name: 'mobile-2x', width: 390, height: 844, deviceScaleFactor: 2 },
	]);
	// First-seen DPR order: 1 (default) then 2.
	assert.deepEqual(
		groups.map((g) => g.deviceScaleFactor),
		[1, 2]
	);
	assert.deepEqual(
		groups.map((g) => g.viewports.map((v) => v.name)),
		[
			['desktop', 'mobile'],
			['desktop-2x', 'mobile-2x'],
		]
	);
});

test('pngDimensions reads width and height from the PNG header', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reglance-cap-'));
	const file = path.join(dir, 'shot.png');
	fs.writeFileSync(
		file,
		PNG.sync.write(new PNG({ width: 780, height: 34162 }))
	);
	assert.deepEqual(pngDimensions(file), { width: 780, height: 34162 });
});

test('pngDimensions returns null for an unreadable file', () => {
	assert.equal(pngDimensions('/no/such/file.png'), null);
});

test('browserLaunchOptions passes configured options through', () => {
	assert.deepEqual(browserLaunchOptions(), {});
	assert.deepEqual(
		browserLaunchOptions({ launchOptions: { chromiumSandbox: true } }),
		{ chromiumSandbox: true }
	);
});

test('browserLaunchOptions appends the certificate flag to configured args', () => {
	const browser = { launchOptions: { args: ['--foo'] } };
	assert.deepEqual(browserLaunchOptions(browser, true), {
		args: ['--foo', '--ignore-certificate-errors'],
	});
	// The config's own array is left alone.
	assert.deepEqual(browser.launchOptions.args, ['--foo']);
});

test('browserContextOptions adds the user agent and context stabilizers', () => {
	assert.deepEqual(
		browserContextOptions({
			deviceScaleFactor: 2,
			ignoreHTTPSErrors: false,
			userAgent: 'Checker/1.0',
			stabilize: {
				animations: 'disabled',
				reducedMotion: 'reduce',
				timezoneId: 'UTC',
				locale: 'en-US',
			},
		}),
		{
			ignoreHTTPSErrors: false,
			deviceScaleFactor: 2,
			userAgent: 'Checker/1.0',
			reducedMotion: 'reduce',
			timezoneId: 'UTC',
			locale: 'en-US',
		}
	);
});

test('browserContextOptions omits what is not configured', () => {
	assert.deepEqual(
		browserContextOptions({
			deviceScaleFactor: 1,
			ignoreHTTPSErrors: true,
		}),
		{ ignoreHTTPSErrors: true, deviceScaleFactor: 1 }
	);
});

test('screenshotOptions adds screenshot stabilizers and mask locators', () => {
	const page = { locator: (selector) => ({ selector }) };
	assert.deepEqual(
		screenshotOptions(page, '/out/home-desktop.png', {
			stabilize: {
				animations: 'disabled',
				caret: 'hide',
				locale: 'en-US',
			},
			mask: ['.ad', '#banner'],
		}),
		{
			path: '/out/home-desktop.png',
			fullPage: true,
			animations: 'disabled',
			caret: 'hide',
			mask: [{ selector: '.ad' }, { selector: '#banner' }],
		}
	);
	assert.deepEqual(screenshotOptions(page, '/out/a.png'), {
		path: '/out/a.png',
		fullPage: true,
	});
});

test('documentResponse keeps status, final URL, and the CDN headers', () => {
	const response = (headers) => ({
		status: () => 403,
		url: () => 'https://site.test/after-redirect/',
		headers: () => headers,
	});
	assert.deepEqual(
		documentResponse(
			response({
				server: 'cloudflare',
				'cf-mitigated': 'challenge',
				etag: 'x',
			})
		),
		{
			status: 403,
			finalUrl: 'https://site.test/after-redirect/',
			headers: { server: 'cloudflare', 'cf-mitigated': 'challenge' },
		}
	);
	assert.deepEqual(documentResponse(response({})).headers, { server: null });
});

test('documentResponse reports nulls when no response arrived', () => {
	assert.deepEqual(documentResponse(null), {
		status: null,
		finalUrl: null,
		headers: { server: null },
	});
});
