import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFailRun, isLocalHost } from '../src/capture.mjs';

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
