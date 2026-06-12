import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	normalizeDomain,
	buildUrl,
	validateViewports,
	filterTargets,
	loadConfig,
	normalizeBlockHosts,
	normalizeImageCache,
	DEFAULT_PIXELMATCH_OPTIONS,
} from '../src/config.mjs';

const TARGETS = [
	{ key: 'home', path: '/' },
	{ key: 'blog', path: '/blog' },
];

/**
 * Write a reglance config to a fresh temp directory and return its path.
 *
 * @param {object} config The config object to serialize.
 * @returns {string} The path to the written config file.
 */
function writeConfig(config) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reglance-test-'));
	const configPath = path.join(dir, 'reglance.json');
	fs.writeFileSync(configPath, JSON.stringify(config));
	return configPath;
}

test('normalizeDomain adds https to a bare host', () => {
	assert.equal(normalizeDomain('site.test'), 'https://site.test');
});

test('normalizeDomain preserves an explicit scheme', () => {
	assert.equal(normalizeDomain('http://site.test'), 'http://site.test');
});

test('normalizeDomain strips trailing slashes', () => {
	assert.equal(normalizeDomain('https://site.test///'), 'https://site.test');
});

test('normalizeDomain trims surrounding whitespace', () => {
	assert.equal(normalizeDomain('  site.test  '), 'https://site.test');
});

test('normalizeDomain rejects an empty domain', () => {
	assert.throws(() => normalizeDomain('   '), /Invalid domain/);
});

test('normalizeDomain rejects a non-string domain', () => {
	assert.throws(() => normalizeDomain(42), /Invalid domain/);
});

test('buildUrl joins a domain and a path', () => {
	assert.equal(
		buildUrl('https://site.test', '/blog'),
		'https://site.test/blog'
	);
});

test('buildUrl inserts a missing leading slash', () => {
	assert.equal(
		buildUrl('https://site.test', 'blog'),
		'https://site.test/blog'
	);
});

test('buildUrl passes an absolute URL through untouched', () => {
	assert.equal(
		buildUrl('https://site.test', 'https://other.test/x'),
		'https://other.test/x'
	);
});

test('validateViewports accepts a well-formed array', () => {
	assert.doesNotThrow(() =>
		validateViewports([{ name: 'desktop', width: 1920, height: 1080 }])
	);
});

test('validateViewports rejects an empty array', () => {
	assert.throws(() => validateViewports([]), /non-empty array/);
});

test('validateViewports rejects a missing name', () => {
	assert.throws(
		() => validateViewports([{ width: 100, height: 100 }]),
		/missing a "name"/
	);
});

test('validateViewports rejects a non-positive dimension', () => {
	assert.throws(
		() => validateViewports([{ name: 'x', width: 0, height: 100 }]),
		/width must be a positive integer/
	);
});

test('validateViewports rejects a non-integer dimension', () => {
	assert.throws(
		() => validateViewports([{ name: 'x', width: 100, height: 'tall' }]),
		/height must be a positive integer/
	);
});

test('validateViewports accepts an optional deviceScaleFactor', () => {
	assert.doesNotThrow(() =>
		validateViewports([
			{ name: 'retina', width: 1920, height: 1080, deviceScaleFactor: 2 },
			{ name: 'frac', width: 800, height: 600, deviceScaleFactor: 1.5 },
		])
	);
});

test('validateViewports rejects a non-positive deviceScaleFactor', () => {
	assert.throws(
		() =>
			validateViewports([
				{ name: 'x', width: 100, height: 100, deviceScaleFactor: 0 },
			]),
		/deviceScaleFactor must be a positive number/
	);
});

test('validateViewports rejects a non-numeric deviceScaleFactor', () => {
	assert.throws(
		() =>
			validateViewports([
				{ name: 'x', width: 100, height: 100, deviceScaleFactor: '2' },
			]),
		/deviceScaleFactor must be a positive number/
	);
});

test('filterTargets returns all targets when no filter is given', () => {
	assert.equal(filterTargets(TARGETS), TARGETS);
	assert.equal(filterTargets(TARGETS, []), TARGETS);
});

test('filterTargets narrows to the requested keys', () => {
	const filtered = filterTargets(TARGETS, ['blog']);
	assert.deepEqual(
		filtered.map((t) => t.key),
		['blog']
	);
});

test('filterTargets throws on an unmatched key and lists known keys', () => {
	assert.throws(
		() => filterTargets(TARGETS, ['blgo']),
		/No matching paths for: blgo\. Known keys: home, blog\./
	);
});

test('loadConfig rejects a path key with traversal or separators', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { '../escape': '/' },
	});
	assert.throws(() => loadConfig({ configPath }), /Invalid path key/);
});

test('validateViewports rejects a name with a path separator', () => {
	assert.throws(
		() => validateViewports([{ name: '../x', width: 10, height: 10 }]),
		/Invalid viewport name/
	);
});

test('loadConfig throws when the file is missing', () => {
	assert.throws(
		() => loadConfig({ configPath: '/nonexistent/reglance.json' }),
		/Config file not found/
	);
});

test('loadConfig throws on invalid JSON', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reglance-test-'));
	const configPath = path.join(dir, 'reglance.json');
	fs.writeFileSync(configPath, '{ not json');
	assert.throws(() => loadConfig({ configPath }), /Could not parse/);
});

test('loadConfig throws when no paths are configured', () => {
	const configPath = writeConfig({ domain: 'site.test', paths: {} });
	assert.throws(() => loadConfig({ configPath }), /No "paths" configured/);
});

test('loadConfig builds targets from paths and domain', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/', blog: '/blog' },
	});
	const config = loadConfig({ configPath });

	assert.equal(config.domain, 'https://site.test');
	assert.deepEqual(
		config.targets.map((t) => t.url),
		['https://site.test/', 'https://site.test/blog']
	);
});

test('loadConfig leaves domain null when none is configured', () => {
	const configPath = writeConfig({ paths: { home: '/' } });
	const config = loadConfig({ configPath });
	assert.equal(config.domain, null);
});

test('loadConfig prefers the domain override', () => {
	const configPath = writeConfig({
		domain: 'config.test',
		paths: { home: '/' },
	});
	const config = loadConfig({ configPath, domain: 'override.test' });
	assert.equal(config.domain, 'https://override.test');
});

test('loadConfig falls back to default viewports', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
	});
	const config = loadConfig({ configPath });
	assert.deepEqual(
		config.viewports.map((v) => v.name),
		['desktop', 'mobile']
	);
});

test('loadConfig validates configured viewports', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		viewports: [{ name: 'desktop', width: -1, height: 1080 }],
	});
	assert.throws(() => loadConfig({ configPath }), /positive integer/);
});

test('loadConfig merges pixelmatch options over the defaults', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		pixelmatchOptions: { threshold: 0.5 },
	});
	const config = loadConfig({ configPath });
	assert.equal(config.pixelmatchOptions.threshold, 0.5);
	assert.equal(
		config.pixelmatchOptions.includeAA,
		DEFAULT_PIXELMATCH_OPTIONS.includeAA
	);
});

test('loadConfig falls back to default timeouts', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
	});
	const config = loadConfig({ configPath });
	assert.equal(config.timeouts.goto, 15000);
	assert.equal(config.timeouts.settle, 8000);
});

test('loadConfig merges configured timeouts over the defaults', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		timeouts: { settle: 20000 },
	});
	const config = loadConfig({ configPath });
	// Overridden value wins; the unspecified one keeps its default.
	assert.equal(config.timeouts.settle, 20000);
	assert.equal(config.timeouts.goto, 15000);
});

test('normalizeBlockHosts defaults a missing value to an empty list', () => {
	assert.deepEqual(normalizeBlockHosts(undefined), []);
});

test('normalizeBlockHosts lowercases entries and strips a *. prefix', () => {
	assert.deepEqual(
		normalizeBlockHosts(['Captcha.Example.com', '*.cdn.example.net']),
		['captcha.example.com', 'cdn.example.net']
	);
});

test('normalizeBlockHosts rejects a non-array value', () => {
	assert.throws(
		() => normalizeBlockHosts('captcha.example.com'),
		/Invalid "blockHosts"/
	);
});

test('normalizeBlockHosts rejects empty and non-string entries', () => {
	assert.throws(() => normalizeBlockHosts(['']), /non-empty string/);
	assert.throws(() => normalizeBlockHosts([42]), /non-empty string/);
});

test('normalizeBlockHosts rejects entries with a scheme, port, or path', () => {
	assert.throws(
		() => normalizeBlockHosts(['https://captcha.example.com']),
		/bare hostname/
	);
	assert.throws(
		() => normalizeBlockHosts(['example.com/path']),
		/bare hostname/
	);
	assert.throws(
		() => normalizeBlockHosts(['example.com:8080']),
		/bare hostname/
	);
});

test('loadConfig defaults blockHosts to an empty list', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
	});
	assert.deepEqual(loadConfig({ configPath }).blockHosts, []);
});

test('loadConfig normalizes configured blockHosts', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		blockHosts: ['*.CDN.example.net', 'captcha.example.com'],
	});
	assert.deepEqual(loadConfig({ configPath }).blockHosts, [
		'cdn.example.net',
		'captcha.example.com',
	]);
});

test('loadConfig rejects a non-array diffColor instead of crashing later', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		pixelmatchOptions: { diffColor: null },
	});
	assert.throws(() => loadConfig({ configPath }), /diffColor/);
});

test('loadConfig rejects an out-of-range diffColor channel', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		pixelmatchOptions: { diffColor: [256, 0, 0] },
	});
	assert.throws(() => loadConfig({ configPath }), /diffColor/);
});

test('loadConfig accepts a valid diffColor triple', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		pixelmatchOptions: { diffColor: [10, 20, 30] },
	});
	assert.deepEqual(
		loadConfig({ configPath }).pixelmatchOptions.diffColor,
		[10, 20, 30]
	);
});

test('loadConfig derives a name from the domain host when unset', () => {
	const configPath = writeConfig({
		domain: 'https://site.test',
		paths: { home: '/' },
	});
	const config = loadConfig({ configPath });
	assert.equal(config.name, 'site.test');
});

test('normalizeImageCache is disabled when absent or false', () => {
	assert.deepEqual(normalizeImageCache(undefined), {
		enabled: false,
		persist: false,
	});
	assert.deepEqual(normalizeImageCache(false), {
		enabled: false,
		persist: false,
	});
});

test('normalizeImageCache enables a per-run cache with true', () => {
	assert.deepEqual(normalizeImageCache(true), {
		enabled: true,
		persist: false,
	});
});

test('normalizeImageCache enables with an options object', () => {
	assert.deepEqual(normalizeImageCache({}), {
		enabled: true,
		persist: false,
	});
	assert.deepEqual(normalizeImageCache({ persist: true }), {
		enabled: true,
		persist: true,
	});
});

test('normalizeImageCache rejects non-boolean, non-object values', () => {
	assert.throws(() => normalizeImageCache('yes'), /Invalid "imageCache"/);
	assert.throws(() => normalizeImageCache([true]), /Invalid "imageCache"/);
});

test('normalizeImageCache rejects a non-boolean persist', () => {
	assert.throws(
		() => normalizeImageCache({ persist: 'always' }),
		/Invalid "imageCache.persist"/
	);
});

test('loadConfig exposes imageCache options and the cache directory', () => {
	const configPath = writeConfig({
		domain: 'site.test',
		paths: { home: '/' },
		imageCache: { persist: true },
	});
	const config = loadConfig({ configPath });
	assert.deepEqual(config.imageCache, { enabled: true, persist: true });
	assert.equal(
		config.dirs.imageCache,
		path.join(config.outputDir, 'image-cache')
	);
});
