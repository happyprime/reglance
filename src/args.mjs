/**
 * Parse an integer CLI flag, throwing an actionable error when it is invalid.
 *
 * Uses `Number` rather than `parseInt` so trailing garbage ("8x") is rejected
 * instead of silently truncated, and enforces a minimum so a value like
 * `--concurrency=0` cannot reach the capture loop and hang it.
 *
 * @param {string} value         The raw flag value.
 * @param {string} name          The flag name, for error messages.
 * @param {object} [options]     Parse options.
 * @param {number} [options.min] The smallest allowed value (default 1).
 * @returns {number} The parsed integer.
 */
export function toInt(value, name, { min = 1 } = {}) {
	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed < min) {
		throw new Error(
			`Invalid value for --${name}: ${value} (expected an integer >= ${min}).`
		);
	}

	return parsed;
}
