import { parentPort } from 'node:worker_threads';
import { compareSlug } from './compare.mjs';

/**
 * Run one comparison off the main thread.
 *
 * PNG decode, pixelmatch, and the HTML line-diff are all CPU-bound and use
 * the synchronous pngjs API, so running each comparison in a worker keeps the
 * main event loop responsive and spreads the work across cores. The worker is
 * reused across jobs; the caller bounds peak memory by limiting how many
 * workers run at once.
 */
parentPort.on('message', ({ config, target, viewport }) => {
	try {
		const result = compareSlug(config, target, viewport);
		parentPort.postMessage({ ok: true, result });
	} catch (error) {
		parentPort.postMessage({
			ok: false,
			error: error.message || String(error),
		});
	}
});
