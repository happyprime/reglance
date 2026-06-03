import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toInt } from '../src/args.mjs';

test('toInt parses a positive integer', () => {
	assert.equal(toInt('8', 'concurrency'), 8);
});

test('toInt rejects zero by default', () => {
	assert.throws(() => toInt('0', 'concurrency'), /expected an integer >= 1/);
});

test('toInt rejects negative values', () => {
	assert.throws(() => toInt('-3', 'concurrency'), /Invalid value/);
});

test('toInt rejects trailing garbage instead of truncating', () => {
	// parseInt('8x') would return 8; Number('8x') is NaN.
	assert.throws(() => toInt('8x', 'concurrency'), /Invalid value/);
});

test('toInt rejects blank input', () => {
	assert.throws(() => toInt('   ', 'concurrency'), /Invalid value/);
});

test('toInt rejects non-integer numbers', () => {
	assert.throws(() => toInt('2.5', 'concurrency'), /Invalid value/);
});

test('toInt allows zero when min is 0 (e.g. --stagger=0)', () => {
	assert.equal(toInt('0', 'stagger', { min: 0 }), 0);
});

test('toInt still rejects negatives when min is 0', () => {
	assert.throws(() => toInt('-1', 'stagger', { min: 0 }), /Invalid value/);
});
