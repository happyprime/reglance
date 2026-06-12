import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openImageCache } from '../src/image-cache.mjs';

/**
 * Create a fresh temp directory for a cache.
 *
 * @returns {string} The directory path.
 */
function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'reglance-cache-test-'));
}

/**
 * Build a minimal stand-in for a Playwright APIResponse.
 *
 * @param {object} [overrides]             Response fields to override.
 * @param {number} [overrides.status]      HTTP status code.
 * @param {string} [overrides.contentType] Content-Type header value.
 * @param {Buffer} [overrides.body]        Response body.
 * @returns {object} The fake response.
 */
function fakeResponse({
	status = 200,
	contentType = 'image/png',
	body = Buffer.from('image-bytes'),
} = {}) {
	return {
		status: () => status,
		ok: () => status >= 200 && status < 300,
		headers: () => (contentType ? { 'content-type': contentType } : {}),
		body: async () => body,
	};
}

test('a fetched image is served from the cache afterward', async () => {
	const cache = openImageCache(tempDir());
	const url = 'https://example.org/photo.jpg';

	assert.equal(await cache.get(url), null);

	let fetcherCalls = 0;
	const fetched = await cache.fetchOnce(url, () => {
		fetcherCalls++;
		return fakeResponse({ body: Buffer.from('hero') });
	});
	assert.equal(fetched.status, 200);
	assert.equal(fetched.contentType, 'image/png');

	const cached = await cache.get(url);
	assert.equal(fetcherCalls, 1);
	assert.equal(cached.status, 200);
	assert.equal(cached.contentType, 'image/png');
	assert.equal(cached.body.toString(), 'hero');
});

test('query strings are part of the cache key', async () => {
	const cache = openImageCache(tempDir());

	await cache.fetchOnce('https://example.org/photo.jpg?w=400', () =>
		fakeResponse({ body: Buffer.from('small') })
	);
	await cache.fetchOnce('https://example.org/photo.jpg?w=800', () =>
		fakeResponse({ body: Buffer.from('large') })
	);

	const small = await cache.get('https://example.org/photo.jpg?w=400');
	const large = await cache.get('https://example.org/photo.jpg?w=800');
	assert.equal(small.body.toString(), 'small');
	assert.equal(large.body.toString(), 'large');
	assert.equal(await cache.get('https://example.org/photo.jpg'), null);
});

test('concurrent fetches for one URL share a single origin request', async () => {
	const cache = openImageCache(tempDir());
	const url = 'https://example.org/shared.png';

	let fetcherCalls = 0;
	const fetcher = async () => {
		fetcherCalls++;
		// Yield so the second fetchOnce arrives while this one is in flight.
		await new Promise((resolve) => setTimeout(resolve, 20));
		return fakeResponse();
	};

	const [first, second] = await Promise.all([
		cache.fetchOnce(url, fetcher),
		cache.fetchOnce(url, fetcher),
	]);

	assert.equal(fetcherCalls, 1);
	assert.equal(first.body.toString(), second.body.toString());
});

test('non-2xx responses pass through without being cached', async () => {
	const cache = openImageCache(tempDir());
	const url = 'https://example.org/missing.png';

	const entry = await cache.fetchOnce(url, () =>
		fakeResponse({ status: 404, body: Buffer.from('not found') })
	);

	assert.equal(entry.status, 404);
	assert.equal(await cache.get(url), null);
});

test('a failed origin fetch rejects and is not poisoned for retries', async () => {
	const cache = openImageCache(tempDir());
	const url = 'https://example.org/flaky.png';

	await assert.rejects(
		cache.fetchOnce(url, () => {
			throw new Error('network down');
		}),
		/network down/
	);

	// The in-flight slot is released, so a retry can fetch successfully.
	const entry = await cache.fetchOnce(url, () => fakeResponse());
	assert.equal(entry.status, 200);
});

test('opening with clear removes existing entries', async () => {
	const dir = tempDir();
	const url = 'https://example.org/stale.png';

	const first = openImageCache(dir);
	await first.fetchOnce(url, () => fakeResponse());
	assert.notEqual(await first.get(url), null);

	const persisted = openImageCache(dir);
	assert.notEqual(await persisted.get(url), null);

	const cleared = openImageCache(dir, { clear: true });
	assert.equal(await cleared.get(url), null);
});

test('stats counts cache hits and origin fetches', async () => {
	const cache = openImageCache(tempDir());
	const url = 'https://example.org/counted.png';

	await cache.fetchOnce(url, () => fakeResponse());
	await cache.get(url);
	await cache.get(url);

	assert.deepEqual(cache.stats(), { hits: 2, fetches: 1 });
});
