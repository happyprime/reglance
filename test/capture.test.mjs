import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFailRun } from '../src/capture.mjs';

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
