import { PNG } from 'pngjs';

// Chromium (via Skia's `kMaxDimension`) refuses to decode an image whose width
// or height exceeds 32,767px (2^15 - 1) and reports it to the console as a
// broken/corrupt image. Full-page mobile captures cross this routinely: a
// narrow viewport stacks content into a very tall page, and a 2x
// deviceScaleFactor doubles the pixel height again. The capture file itself is
// valid PNG — only the browser viewing the report can't paint it — so we keep
// the full-resolution original for pixelmatch and hand the report a downscaled
// copy that always decodes.
export const MAX_DISPLAY_DIMENSION = 32767;

/**
 * The dimensions an image should be displayed at to stay within the browser's
 * decode limit, preserving aspect ratio.
 *
 * The longest side is clamped to `max` and the shorter side scaled to match.
 * `floor` (not round) guarantees neither side can land back on `max + 1`.
 *
 * @param {number} width  The source width in pixels.
 * @param {number} height The source height in pixels.
 * @param {number} [max]  The maximum allowed dimension.
 * @returns {{ width: number, height: number, scale: number, downscaled: boolean }}
 *   The display size; `downscaled` is false when the source already fits.
 */
export function displayDimensions(width, height, max = MAX_DISPLAY_DIMENSION) {
	const longest = Math.max(width, height);
	if (longest <= max) {
		return { width, height, scale: 1, downscaled: false };
	}

	const scale = max / longest;
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)),
		scale,
		downscaled: true,
	};
}

/**
 * Map each output index to the weighted list of input samples that cover it
 * under area (box) averaging.
 *
 * Area resampling — rather than nearest-neighbor — keeps text and thin
 * one-pixel borders legible when a tall capture is shrunk: every output pixel
 * is the coverage-weighted average of the input pixels its footprint overlaps.
 * Each entry is a flat `[index, weight, index, weight, …]` array whose weights
 * sum to 1.
 *
 * @param {number} srcSize The source length along this axis.
 * @param {number} dstSize The destination length along this axis.
 * @returns {number[][]} One contribution list per destination index.
 */
function buildContributions(srcSize, dstSize) {
	const support = srcSize / dstSize; // source pixels spanned per output pixel
	const lines = [];

	for (let d = 0; d < dstSize; d++) {
		const start = d * support;
		const end = start + support;
		const first = Math.floor(start);
		const last = Math.min(srcSize - 1, Math.ceil(end) - 1);

		const contrib = [];
		let total = 0;
		for (let s = first; s <= last; s++) {
			// Width of the overlap between this output footprint and source
			// pixel `s` (which spans [s, s + 1)).
			const weight = Math.min(end, s + 1) - Math.max(start, s);
			if (weight > 0) {
				contrib.push(s, weight);
				total += weight;
			}
		}
		for (let i = 1; i < contrib.length; i += 2) {
			contrib[i] /= total;
		}
		lines.push(contrib);
	}

	return lines;
}

/**
 * Resize an RGBA pixel buffer with a separable area filter.
 *
 * Horizontal then vertical, each pass a 1D area resample (see
 * buildContributions). An axis whose size is unchanged is passed through
 * untouched.
 *
 * @param {Uint8Array|Buffer} src The source RGBA bytes.
 * @param {number}            sw  Source width.
 * @param {number}            sh  Source height.
 * @param {number}            tw  Target width.
 * @param {number}            th  Target height.
 * @returns {Uint8Array} The resized RGBA bytes (`tw * th * 4`).
 */
export function resizeRGBA(src, sw, sh, tw, th) {
	let data = src;
	let width = sw;

	if (tw !== width) {
		const cols = buildContributions(width, tw);
		const out = new Uint8Array(tw * sh * 4);
		for (let y = 0; y < sh; y++) {
			const srcRow = y * width * 4;
			const dstRow = y * tw * 4;
			for (let x = 0; x < tw; x++) {
				const c = cols[x];
				let r = 0;
				let g = 0;
				let b = 0;
				let a = 0;
				for (let i = 0; i < c.length; i += 2) {
					const p = srcRow + c[i] * 4;
					const w = c[i + 1];
					r += data[p] * w;
					g += data[p + 1] * w;
					b += data[p + 2] * w;
					a += data[p + 3] * w;
				}
				const d = dstRow + x * 4;
				out[d] = r + 0.5;
				out[d + 1] = g + 0.5;
				out[d + 2] = b + 0.5;
				out[d + 3] = a + 0.5;
			}
		}
		data = out;
		width = tw;
	}

	if (th !== sh) {
		const rows = buildContributions(sh, th);
		const out = new Uint8Array(width * th * 4);
		for (let y = 0; y < th; y++) {
			const c = rows[y];
			const dstRow = y * width * 4;
			for (let x = 0; x < width; x++) {
				const col = x * 4;
				let r = 0;
				let g = 0;
				let b = 0;
				let a = 0;
				for (let i = 0; i < c.length; i += 2) {
					const p = c[i] * width * 4 + col;
					const w = c[i + 1];
					r += data[p] * w;
					g += data[p + 1] * w;
					b += data[p + 2] * w;
					a += data[p + 3] * w;
				}
				const d = dstRow + col;
				out[d] = r + 0.5;
				out[d + 1] = g + 0.5;
				out[d + 2] = b + 0.5;
				out[d + 3] = a + 0.5;
			}
		}
		data = out;
	}

	return data;
}

/**
 * Downscale a decoded PNG to fit the browser decode limit, if it exceeds it.
 *
 * Returns metadata describing the result; when downscaling was needed, `png`
 * is a fresh PNG at the display size, otherwise it's the original. Callers use
 * the metadata to point the report at the right file and to warn the viewer.
 *
 * @param {{ width: number, height: number, data: Uint8Array }} source The decoded PNG.
 * @param {number}                                              [max]  The maximum allowed dimension.
 * @returns {{ downscaled: boolean, png: object, width: number, height: number,
 *   originalWidth: number, originalHeight: number, scale: number }} The result.
 */
export function downscaleToDisplay(source, max = MAX_DISPLAY_DIMENSION) {
	const dims = displayDimensions(source.width, source.height, max);

	if (!dims.downscaled) {
		return {
			downscaled: false,
			png: source,
			width: source.width,
			height: source.height,
			originalWidth: source.width,
			originalHeight: source.height,
			scale: 1,
		};
	}

	const png = new PNG({ width: dims.width, height: dims.height });
	png.data.set(
		resizeRGBA(
			source.data,
			source.width,
			source.height,
			dims.width,
			dims.height
		)
	);

	return {
		downscaled: true,
		png,
		width: dims.width,
		height: dims.height,
		originalWidth: source.width,
		originalHeight: source.height,
		scale: dims.scale,
	};
}
