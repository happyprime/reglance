import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));

const templateCache = new Map();

// Lines of unchanged context kept around each change in the HTML diff. Runs of
// unchanged lines longer than twice this are collapsed into a single gap marker.
const HTML_DIFF_CONTEXT = 3;

// Void elements never enclose a hunk, so they're skipped when looking for the
// nearest enclosing tag for a hunk header.
const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

/**
 * Read a template file that ships with the package.
 *
 * Memoized: templates don't change during a run, and these are read once per
 * comparison, so caching avoids redundant blocking reads.
 *
 * @param {string} name The template filename.
 * @returns {string} The template contents.
 */
function readTemplate(name) {
	let cached = templateCache.get(name);
	if (cached === undefined) {
		cached = fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
		templateCache.set(name, cached);
	}
	return cached;
}

/**
 * Copy the report assets (CSS/JS) into the output directory.
 *
 * @param {object} config The normalized config.
 */
export function copyAssets(config) {
	fs.mkdirSync(config.dirs.assets, { recursive: true });
	fs.cpSync(path.join(TEMPLATES_DIR, 'assets'), config.dirs.assets, {
		recursive: true,
	});
}

/**
 * Escape HTML special characters.
 *
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * A device-pixel-ratio suffix for a viewport, e.g. ` @2x`.
 *
 * Returns an empty string at the default ratio of 1 so standard captures read
 * cleanly and only retina / high-density viewports are annotated.
 *
 * @param {object} viewport The viewport definition.
 * @returns {string} The suffix (with a leading space) or an empty string.
 */
export function dprLabel(viewport) {
	const dpr = viewport?.deviceScaleFactor ?? 1;
	return dpr === 1 ? '' : ` @${dpr}x`;
}

/**
 * Serialize a value for embedding in an inline <script>.
 *
 * JSON.stringify does not neutralize `</script>` or the U+2028/U+2029 line
 * separators, which can break out of the script element, so escape them.
 *
 * @param {*} value The value to serialize.
 * @returns {string} Script-safe JSON.
 */
function jsonForScript(value) {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

/**
 * A POSIX-style relative path so report URLs work regardless of host OS.
 *
 * @param {string} from The directory the path is relative to.
 * @param {string} to   The target path.
 * @returns {string} The forward-slashed relative path.
 */
function relPosix(from, to) {
	return path.relative(from, to).split(path.sep).join('/');
}

/**
 * Split a snapshot into lines, dropping the single empty element a trailing
 * newline would otherwise produce so line counts match the document.
 *
 * @param {string} text The snapshot text.
 * @returns {string[]} The lines.
 */
function toLines(text) {
	const lines = text.split('\n');
	if (lines.length > 1 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

/**
 * Find the nearest enclosing open tag above a line, for a hunk header.
 *
 * Walks the old document backwards from the hunk's first line, balancing
 * closing tags against opening ones, and returns the first unclosed opening
 * tag line (e.g. `<main id="content">`). Returns an empty string when none is
 * found — the heuristic only matches lines that are a single tag, which is the
 * common case for formatted markup and harmless to miss otherwise.
 *
 * @param {string[]} oldLines  The old snapshot's lines.
 * @param {number}   fromIndex Zero-based index of the hunk's first old line.
 * @returns {string} The enclosing tag line, or an empty string.
 */
function enclosingTag(oldLines, fromIndex) {
	let depth = 0;
	for (let i = fromIndex - 1; i >= 0; i--) {
		const line = oldLines[i]?.trim() ?? '';
		if (/^<\/[a-zA-Z][\w-]*\s*>$/.test(line)) {
			depth++;
			continue;
		}
		const open = line.match(/^<([a-zA-Z][\w-]*)\b[^>]*>$/);
		if (open && !line.endsWith('/>')) {
			if (VOID_ELEMENTS.has(open[1].toLowerCase())) {
				continue;
			}
			if (depth > 0) {
				depth--;
				continue;
			}
			return line;
		}
	}
	return '';
}

/**
 * Diff two HTML snapshots into changed-line counts and unified-diff hunks.
 *
 * Replaces the old boolean "Yes/No" HTML signal: the redesigned report shows
 * `+added −removed` counts and renders the diff client-side from JSON hunks.
 * Hunks carry `{ o, n, ctx, lines }` (old/new start line, enclosing tag, and
 * `['+'|'-'|' ', text]` rows); long unchanged runs collapse to `{ gap: N }`.
 *
 * @param {string}   html1     The control (baseline) HTML.
 * @param {string}   html2     The latest (capture) HTML.
 * @param {Function} diffLines The diffLines function from the diff package.
 * @returns {{ add: number, del: number, hunks: Array }} The diff data.
 */
export function buildHtmlDiff(html1, html2, diffLines) {
	const oldLines = toLines(html1);
	const changes = diffLines(html1, html2);

	// Flatten the part-based diff into per-line tokens carrying their old/new
	// line numbers, so the hunk builder can emit gutters and headers.
	const tokens = [];
	let add = 0;
	let del = 0;
	let o = 1;
	let n = 1;
	for (const part of changes) {
		const sign = part.added ? '+' : part.removed ? '-' : ' ';
		for (const text of toLines(part.value)) {
			// `oa` is the line's anchor in the old document: its own old line
			// for context/removed lines, or the line an insertion sits before.
			if (sign === '+') {
				tokens.push({ t: '+', s: text, o: null, n, oa: o });
				n++;
				add++;
			} else if (sign === '-') {
				tokens.push({ t: '-', s: text, o, n: null, oa: o });
				o++;
				del++;
			} else {
				tokens.push({ t: ' ', s: text, o, n, oa: o });
				o++;
				n++;
			}
		}
	}

	if (add === 0 && del === 0) {
		return { add, del, hunks: [] };
	}

	// Mark every line within HTML_DIFF_CONTEXT of a change as kept; the rest
	// collapse into gaps. Contiguous kept runs become hunks.
	const keep = new Array(tokens.length).fill(false);
	tokens.forEach((tok, i) => {
		if (tok.t === ' ') {
			return;
		}
		const lo = Math.max(0, i - HTML_DIFF_CONTEXT);
		const hi = Math.min(tokens.length - 1, i + HTML_DIFF_CONTEXT);
		for (let j = lo; j <= hi; j++) {
			keep[j] = true;
		}
	});

	const hunks = [];
	let i = 0;
	while (i < tokens.length) {
		if (!keep[i]) {
			let gap = 0;
			while (i < tokens.length && !keep[i]) {
				gap++;
				i++;
			}
			hunks.push({ gap });
			continue;
		}
		const start = i;
		const lines = [];
		let firstChanged = null;
		while (i < tokens.length && keep[i]) {
			if (firstChanged === null && tokens[i].t !== ' ') {
				firstChanged = tokens[i];
			}
			lines.push([tokens[i].t, tokens[i].s]);
			i++;
		}
		const head = tokens[start];
		const hunkO = head.o ?? head.n ?? 1;
		const hunkN = head.n ?? head.o ?? 1;
		// Anchor the enclosing-tag search at the first changed line so a tag
		// shown as leading context still resolves as the hunk's container.
		const anchor = (firstChanged ?? head).oa;
		hunks.push({
			o: hunkO,
			n: hunkN,
			ctx: enclosingTag(oldLines, anchor - 1),
			lines,
		});
	}

	return { add, del, hunks };
}

/**
 * Assemble the report data blob and write the single-page report.
 *
 * The redesigned report is one `index.html` that embeds every result as JSON
 * (`window.REGLANCE`) and renders the overview, comparison, and HTML-diff
 * views client-side from the location hash. Image artifacts are referenced by
 * relative path; nothing is fetched over the network.
 *
 * @param {object} config  The normalized config.
 * @param {Array}  reports The comparison results (one per slug).
 * @param {object} [meta]  Run metadata ({ comparedAt, baselineAt, duration }).
 * @returns {string} Path to the written index file.
 */
export function generateReport(config, reports, meta = {}) {
	const { dirs, name, domain, viewports, pixelmatchOptions } = config;
	const rel = (target) => relPosix(dirs.reports, target);

	// Group the flat per-slug results into one entry per page, keyed by viewport.
	const pageMap = new Map();
	for (const report of reports) {
		let page = pageMap.get(report.urlKey);
		if (!page) {
			page = {
				key: report.urlKey,
				url: report.url,
				path: report.path,
				results: {},
			};
			pageMap.set(report.urlKey, page);
		}
		const result = {
			vp: report.viewport.name,
			diff: Number(report.diffPercentage.toFixed(4)),
			add: report.htmlAdd,
			del: report.htmlDel,
			img: {
				control: rel(report.controlImage),
				capture: rel(report.captureImage),
				diff: rel(report.diffImage),
			},
			htmlDiff: report.htmlHunks,
		};
		// Surface the "too large to diff" note only when one is present.
		if (report.htmlNote) {
			result.note = report.htmlNote;
		}
		page.results[report.viewport.name] = result;
	}

	const vpOrder = viewports.map((v) => v.name);
	const pages = [...pageMap.values()].map((page) => {
		const results = Object.values(page.results);
		const max = results.reduce((m, r) => Math.max(m, r.diff), 0);
		// HTML is captured per viewport but is usually identical; surface the
		// largest counts so a page-level change is never under-reported.
		const add = results.reduce((m, r) => Math.max(m, r.add), 0);
		const del = results.reduce((m, r) => Math.max(m, r.del), 0);
		return { ...page, max, add, del };
	});

	const data = {
		name,
		domain: domain ? new URL(domain).host : '',
		comparedAt: meta.comparedAt ?? '',
		baselineAt: meta.baselineAt ?? '',
		duration: meta.duration ?? '',
		settings: {
			threshold: pixelmatchOptions.threshold,
			includeAA: pixelmatchOptions.includeAA ? 'Yes' : 'No',
			alpha: pixelmatchOptions.alpha,
			diffColor: pixelmatchOptions.diffColor.join(', '),
		},
		viewports: viewports.map((v) => ({
			name: v.name,
			width: v.width,
			height: v.height,
			dpr: v.deviceScaleFactor ?? 1,
		})),
		// Sort viewport order inside each page to match the configured order.
		pages: pages.map((page) => {
			const ordered = {};
			for (const vpName of vpOrder) {
				if (page.results[vpName]) {
					ordered[vpName] = page.results[vpName];
				}
			}
			return { ...page, results: ordered };
		}),
	};

	const template = readTemplate('index.html');
	const indexHtml = template
		.replaceAll('{title}', escapeHtml(name))
		.replaceAll('{data}', jsonForScript(data));

	const indexPath = path.join(dirs.reports, 'index.html');
	fs.writeFileSync(indexPath, indexHtml);

	return indexPath;
}
