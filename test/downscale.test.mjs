import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
	MAX_DISPLAY_DIMENSION,
	displayDimensions,
	resizeRGBA,
	downscaleToDisplay,
} from '../src/downscale.mjs';

test('displayDimensions leaves an in-range image untouched', () => {
	const result = displayDimensions(780, 20000);
	assert.deepEqual(result, {
		width: 780,
		height: 20000,
		scale: 1,
		downscaled: false,
	});
});

test('displayDimensions treats the limit itself as in range', () => {
	const result = displayDimensions(780, MAX_DISPLAY_DIMENSION);
	assert.equal(result.downscaled, false);
	assert.equal(result.height, MAX_DISPLAY_DIMENSION);
});

test('displayDimensions clamps the longest side and keeps aspect ratio', () => {
	const result = displayDimensions(780, 34162);
	assert.equal(result.downscaled, true);
	// Longest side never exceeds the limit, and floor keeps it strictly within.
	assert.ok(result.height <= MAX_DISPLAY_DIMENSION);
	assert.equal(result.height, MAX_DISPLAY_DIMENSION);
	// Width scaled by the same factor (780 * 32767 / 34162 ≈ 748).
	assert.equal(
		result.width,
		Math.floor((780 * MAX_DISPLAY_DIMENSION) / 34162)
	);
});

test('displayDimensions clamps width when width is the longest side', () => {
	const result = displayDimensions(40000, 1000);
	assert.equal(result.downscaled, true);
	assert.equal(result.width, MAX_DISPLAY_DIMENSION);
	assert.ok(result.width <= MAX_DISPLAY_DIMENSION);
});

test('displayDimensions never produces a zero dimension', () => {
	// An extreme aspect ratio would floor the short side to 0 without the guard.
	const result = displayDimensions(2, 100000);
	assert.ok(result.width >= 1);
	assert.ok(result.height >= 1);
});

test('resizeRGBA halving a flat color preserves that color', () => {
	// A 4x4 solid block averaged down to 2x2 stays the same color (area filter).
	const sw = 4;
	const sh = 4;
	const src = new Uint8Array(sw * sh * 4);
	for (let i = 0; i < src.length; i += 4) {
		src[i] = 20;
		src[i + 1] = 120;
		src[i + 2] = 200;
		src[i + 3] = 255;
	}
	const out = resizeRGBA(src, sw, sh, 2, 2);
	assert.equal(out.length, 2 * 2 * 4);
	for (let i = 0; i < out.length; i += 4) {
		assert.equal(out[i], 20);
		assert.equal(out[i + 1], 120);
		assert.equal(out[i + 2], 200);
		assert.equal(out[i + 3], 255);
	}
});

test('resizeRGBA averages a two-color split at the boundary', () => {
	// Left half black, right half white, 2px wide -> 1px is their average.
	const src = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
	const out = resizeRGBA(src, 2, 1, 1, 1);
	assert.equal(out[0], 128); // (0 + 255) / 2 = 127.5, rounded to 128
});

test('downscaleToDisplay passes through an image that already fits', () => {
	const png = new PNG({ width: 10, height: 10 });
	const result = downscaleToDisplay(png);
	assert.equal(result.downscaled, false);
	assert.equal(result.png, png);
	assert.equal(result.width, 10);
	assert.equal(result.height, 10);
});

test('downscaleToDisplay shrinks an oversized image and reports both sizes', () => {
	const height = MAX_DISPLAY_DIMENSION + 500;
	const png = new PNG({ width: 8, height });
	const result = downscaleToDisplay(png);
	assert.equal(result.downscaled, true);
	assert.equal(result.originalHeight, height);
	assert.equal(result.height, MAX_DISPLAY_DIMENSION);
	assert.ok(result.height <= MAX_DISPLAY_DIMENSION);
	assert.equal(result.png.width, result.width);
	assert.equal(result.png.height, result.height);
});
