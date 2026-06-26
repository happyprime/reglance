/*
 * Reglance report — vanilla rendering of the redesigned triage UI.
 *
 * Reads the run data embedded as `window.REGLANCE` and renders three views
 * (overview, comparison, HTML diff) client-side from the location hash. No
 * framework, no network: the file opens straight from disk.
 */
(function () {
	'use strict';

	var R = window.REGLANCE;
	var VPS = R.viewports;
	var root = document.getElementById('root');
	var reduceMotion = window.matchMedia(
		'(prefers-reduced-motion: reduce)'
	).matches;

	// Derive the per-page "changed" flag once. max/add/del are precomputed by
	// the generator; a page counts as changed with any visual or HTML delta.
	R.pages.forEach(function (p) {
		p.changed = p.max > 0 || p.add > 0 || p.del > 0;
	});

	/* ============ data helpers ============ */

	/**
	 * Format a diff percentage for display.
	 *
	 * @param {number} d The diff percentage.
	 * @returns {string} The formatted value, e.g. "2.18%".
	 */
	function fmt(d) {
		return d.toFixed(2) + '%';
	}

	/**
	 * Classify a diff percentage into a severity bucket.
	 *
	 * @param {number} d The diff percentage.
	 * @returns {string} One of "high", "med", "low", or "none".
	 */
	function sev(d) {
		return d >= 0.5 ? 'high' : d >= 0.1 ? 'med' : d > 0 ? 'low' : 'none';
	}

	/**
	 * The dimensions label for a viewport, e.g. "1366×768" or "390×844 @2x".
	 *
	 * @param {string} name The viewport name.
	 * @returns {string} The label, or an empty string when unknown.
	 */
	function vpMeta(name) {
		var v = VPS.find(function (x) {
			return x.name === name;
		});
		if (!v) {
			return '';
		}
		return v.width + '×' + v.height + (v.dpr > 1 ? ' @' + v.dpr + 'x' : '');
	}

	/**
	 * Flatten every page into its individual page × viewport results.
	 *
	 * @returns {Array} One `{ page, vp, r }` entry per result.
	 */
	function flat() {
		var out = [];
		R.pages.forEach(function (p) {
			VPS.forEach(function (v) {
				var r = p.results[v.name];
				if (r) {
					out.push({ page: p, vp: v.name, r: r });
				}
			});
		});
		return out;
	}

	/**
	 * The triage queue: results with a visual difference, worst first.
	 *
	 * @returns {Array} The sorted `{ page, vp, r }` entries.
	 */
	function changedQueue() {
		return flat()
			.filter(function (x) {
				return x.r.diff > 0;
			})
			.sort(function (a, b) {
				return (
					b.r.diff - a.r.diff || a.page.key.localeCompare(b.page.key)
				);
			});
	}

	/**
	 * Clamp a number to the 0–1 range.
	 *
	 * @param {number} x The value to clamp.
	 * @returns {number} The clamped value.
	 */
	function clamp01(x) {
		return Math.max(0, Math.min(1, x));
	}

	/**
	 * Look up a page by key, falling back to the first page.
	 *
	 * @param {string} key The page key.
	 * @returns {object} The matching page.
	 */
	function pageFor(key) {
		return (
			R.pages.find(function (p) {
				return p.key === key;
			}) || R.pages[0]
		);
	}

	/**
	 * Resolve a usable viewport name for a page, falling back to its first.
	 *
	 * @param {object} page The page.
	 * @param {string} name The requested viewport name.
	 * @returns {string} A viewport name that exists on the page.
	 */
	function resolveVp(page, name) {
		return page.results[name] ? name : Object.keys(page.results)[0];
	}

	/* ============ tiny DOM helper ============ */

	/**
	 * Build an element. Data-derived text uses `text` (textContent) so untrusted
	 * page keys, URLs, and HTML source can never inject markup.
	 *
	 * @param {string}            tag        The tag name.
	 * @param {object}            [props]    Attributes/handlers: `class`, `text`,
	 *                                       `html`, `style` object, `on*` listeners, else a plain attribute.
	 * @param {Array|Node|string} [children] Children to append.
	 * @returns {HTMLElement} The element.
	 */
	function h(tag, props, children) {
		var node = document.createElement(tag);
		if (props) {
			Object.keys(props).forEach(function (k) {
				var v = props[k];
				if (v == null || v === false) {
					return;
				}
				if (k === 'class') {
					node.className = v;
				} else if (k === 'text') {
					node.textContent = v;
				} else if (k === 'html') {
					node.innerHTML = v;
				} else if (k === 'style' && typeof v === 'object') {
					Object.assign(node.style, v);
				} else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
					node.addEventListener(k.slice(2).toLowerCase(), v);
				} else if (v === true) {
					node.setAttribute(k, '');
				} else {
					node.setAttribute(k, v);
				}
			});
		}
		append(node, children);
		return node;
	}

	/**
	 * Append children (arrays, nodes, or strings) to a node.
	 *
	 * @param {Node}              node     The parent node.
	 * @param {Array|Node|string} children The children to append.
	 */
	function append(node, children) {
		if (children == null || children === false) {
			return;
		}
		if (Array.isArray(children)) {
			children.forEach(function (c) {
				append(node, c);
			});
		} else if (children instanceof Node) {
			node.appendChild(children);
		} else {
			node.appendChild(document.createTextNode(String(children)));
		}
	}

	/* ============ shared pieces ============ */

	/**
	 * The `+added −removed` HTML-change count, or an em dash when unchanged.
	 *
	 * @param {number} add Lines added.
	 * @param {number} del Lines removed.
	 * @returns {HTMLElement} The count element.
	 */
	function htmlCount(add, del) {
		if (!add && !del) {
			return h('span', { class: 'htmlct none', text: '—' });
		}
		return h(
			'span',
			{
				class: 'htmlct',
				title: add + ' lines added, ' + del + ' removed',
			},
			[
				h('span', { class: 'a', text: '+' + add }),
				h('span', { class: 'd', text: '−' + del }),
			]
		);
	}

	/**
	 * The Reglance wordmark (glyph + name).
	 *
	 * @returns {HTMLElement} The wordmark element.
	 */
	function glyph() {
		return h('span', {
			class: 'wordmark',
			html:
				'<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">' +
				'<rect x="2" y="2" width="12.5" height="12.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"></rect>' +
				'<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="3" fill="currentColor"></rect>' +
				'</svg><b>Reglance</b>',
		});
	}

	/**
	 * The settings popover listing the pixelmatch options used for the run.
	 *
	 * @returns {HTMLElement} The `<details>` popover.
	 */
	function settingsPop() {
		var s = R.settings;
		return h('details', { class: 'settings-pop' }, [
			h('summary', { class: 'ghost-btn', text: 'Settings' }),
			h('div', { class: 'pop' }, [
				h('h3', { text: 'Comparison settings' }),
				h('p', {
					class: 'note',
					text: 'pixelmatch options used for this run.',
				}),
				h('dl', {}, [
					h('dt', { text: 'Threshold' }),
					h('dd', { text: String(s.threshold) }),
					h('dt', { text: 'Anti-aliasing' }),
					h('dd', { text: s.includeAA }),
					h('dt', { text: 'Alpha' }),
					h('dd', { text: String(s.alpha) }),
					h('dt', { text: 'Diff color' }),
					h('dd', {
						text: 'rgb(' + s.diffColor + ')',
						style: { color: 'rgb(' + s.diffColor + ')' },
					}),
				]),
			]),
		]);
	}

	/**
	 * The sticky top bar with the wordmark, run metadata, and settings.
	 *
	 * @returns {HTMLElement} The header element.
	 */
	function topbar() {
		var meta = h('span', { class: 'runmeta' });
		append(meta, [h('b', { text: R.name }), ' · ' + R.domain]);
		if (R.comparedAt) {
			append(meta, ' · compared ' + R.comparedAt);
		}
		if (R.baselineAt) {
			append(meta, ' · baseline ' + R.baselineAt);
		}
		return h('header', { class: 'topbar' }, [
			glyph(),
			meta,
			h('span', { class: 'topbar-spacer' }),
			settingsPop(),
		]);
	}

	/**
	 * The fixed keyboard-hint bar.
	 *
	 * @param {Array} parts `{ keys, label }` hints to render.
	 * @returns {HTMLElement} The hint bar element.
	 */
	function hintbar(parts) {
		return h(
			'div',
			{ class: 'hintbar' },
			parts.map(function (p) {
				return h('span', {}, [
					p.keys.map(function (k) {
						return h('kbd', { text: k });
					}),
					' ' + p.label,
				]);
			})
		);
	}

	/**
	 * A `<kbd>` chip.
	 *
	 * @param {string} k The key label.
	 * @returns {HTMLElement} The kbd element.
	 */
	function kbd(k) {
		return h('kbd', { text: k });
	}

	/* ============ routing & global state ============ */

	var lastPage = null;
	var ql = null; // index into the changed queue, or null
	var helpOpen = false;
	var viewKey = null; // the active view's key handler
	var blinkTimer = null;

	/**
	 * Parse the location hash into a route descriptor.
	 *
	 * @returns {object} `{ v, p?, vp? }` — view and optional page/viewport.
	 */
	function parseHash() {
		var hsh = location.hash.replace(/^#\/?/, '');
		if (!hsh) {
			return { v: 'overview' };
		}
		var parts = hsh.split('/').map(decodeURIComponent);
		if ((parts[0] === 'cmp' || parts[0] === 'html') && parts[1]) {
			return { v: parts[0], p: parts[1], vp: parts[2] || '' };
		}
		return { v: 'overview' };
	}

	/**
	 * Build the hash for a route descriptor.
	 *
	 * @param {object} r The route descriptor.
	 * @returns {string} The hash string.
	 */
	function hashFor(r) {
		if (r.v === 'overview') {
			return '#/';
		}
		return (
			'#/' +
			r.v +
			'/' +
			encodeURIComponent(r.p) +
			'/' +
			encodeURIComponent(r.vp)
		);
	}

	/**
	 * Navigate to a route by setting the hash (a no-op when already there).
	 *
	 * @param {object} r The route descriptor.
	 */
	function go(r) {
		var hsh = hashFor(r);
		if (location.hash === hsh) {
			return;
		}
		location.hash = hsh;
	}

	/**
	 * Render the view for the current hash, tearing down any running blink.
	 */
	function render() {
		if (blinkTimer) {
			clearInterval(blinkTimer);
			blinkTimer = null;
		}
		viewKey = null;
		root.innerHTML = '';
		var route = parseHash();
		if (route.v === 'cmp') {
			renderCompare(route);
		} else if (route.v === 'html') {
			renderHtmlDiff(route);
		} else {
			renderOverview();
		}
	}

	window.addEventListener('hashchange', function () {
		var route = parseHash();
		if (route.p) {
			lastPage = route.p;
		}
		window.scrollTo({ top: 0 });
		render();
	});

	/* ============ overview ============ */

	/**
	 * The index of the worst (highest-diff) result in a list.
	 *
	 * @param {Array} rs The results.
	 * @returns {number} The worst index.
	 */
	function worstIdx(rs) {
		var wi = 0;
		rs.forEach(function (r, i) {
			if (r.diff > rs[wi].diff) {
				wi = i;
			}
		});
		return wi;
	}

	/**
	 * Render the triage overview: summary, filters, and the grouped page list.
	 */
	function renderOverview() {
		var state = {
			seg: 'changed',
			vpf: 'all',
			q: '',
			sel: 0,
			selVp: -1,
			rows: [],
			cards: [],
			initSel: true,
		};

		// Segmented counts are page-level and independent of the active filters.
		var changedPages = R.pages.filter(function (p) {
			return p.changed;
		}).length;
		var segCounts = {
			changed: changedPages,
			all: R.pages.length,
			clean: R.pages.length - changedPages,
		};

		var segButtons = {};
		var segLabels = { changed: 'Changed', all: 'All', clean: 'Clean' };
		var changeSeg = h(
			'div',
			{
				class: 'seg',
				role: 'group',
				'aria-label': 'Filter by change state',
			},
			['changed', 'all', 'clean'].map(function (s) {
				var btn = h('button', {
					'aria-pressed': state.seg === s ? 'true' : 'false',
					onclick: function () {
						state.seg = s;
						renderList(state);
					},
				});
				append(btn, [
					segLabels[s],
					h('span', { class: 'ct', text: String(segCounts[s]) }),
				]);
				segButtons[s] = btn;
				return btn;
			})
		);
		state.segButtons = segButtons;

		var vpButtons = {};
		var vpSeg = h(
			'div',
			{ class: 'seg', role: 'group', 'aria-label': 'Filter by viewport' },
			[
				h('button', {
					'aria-pressed': 'true',
					text: 'All viewports',
					onclick: function () {
						state.vpf = 'all';
						renderList(state);
					},
				}),
			].concat(
				VPS.map(function (v) {
					var btn = h('button', {
						'aria-pressed': 'false',
						text: v.name,
						onclick: function () {
							state.vpf = v.name;
							renderList(state);
						},
					});
					vpButtons[v.name] = btn;
					return btn;
				})
			)
		);
		vpButtons.all = vpSeg.firstChild;
		state.vpButtons = vpButtons;

		var searchInput = h('input', {
			value: '',
			placeholder: 'Filter pages…',
			'aria-label': 'Filter pages',
			oninput: function (e) {
				state.q = e.target.value;
				renderList(state);
			},
			onkeydown: function (e) {
				if (e.key === 'Escape' || e.key === 'Enter') {
					e.target.blur();
				}
			},
		});
		state.searchInput = searchInput;
		var search = h('label', { class: 'search' }, [
			h('span', { 'aria-hidden': 'true', text: '⌕' }),
			searchInput,
			kbd('/'),
		]);

		var toolbar = h('div', { class: 'toolbar' }, [
			changeSeg,
			vpSeg,
			search,
		]);

		var summary = h('div', { class: 'summary' }, [
			h('h1', { class: 'headline' }, [
				h('span', { class: 'num', text: String(changedPages) }),
				' of ' + R.pages.length + ' pages changed',
			]),
			h('span', { class: 'sub' }, [
				h('b', { text: flat().length + ' comparisons' }),
				' across ' +
					VPS.length +
					' viewports' +
					(R.duration ? ' · ran in ' + R.duration : ''),
			]),
		]);

		var listWrap = h('div', { id: 'ov-list' });
		state.listWrap = listWrap;

		root.appendChild(topbar());
		root.appendChild(summary);
		root.appendChild(toolbar);
		root.appendChild(listWrap);
		root.appendChild(
			hintbar([
				{ keys: ['j', 'k'], label: 'navigate' },
				{ keys: ['←', '→'], label: 'viewport' },
				{ keys: ['↵'], label: 'compare' },
				{ keys: ['space'], label: 'quick look' },
				{ keys: ['h'], label: 'HTML diff' },
				{ keys: ['?'], label: 'shortcuts' },
			])
		);

		viewKey = function (e) {
			overviewKey(e, state);
		};

		renderList(state);
	}

	/**
	 * Compute the filtered, sorted page rows for the current overview state.
	 *
	 * @param {object} state The overview state.
	 * @returns {Array} `{ p, rs, max, signal }` rows, worst first.
	 */
	function computeRows(state) {
		var query = state.q.toLowerCase();
		return R.pages
			.map(function (p) {
				var rs = VPS.filter(function (v) {
					return state.vpf === 'all' || v.name === state.vpf;
				})
					.map(function (v) {
						return p.results[v.name];
					})
					.filter(Boolean);
				var max = rs.reduce(function (m, r) {
					return Math.max(m, r.diff);
				}, 0);
				var signal = max > 0 || p.add > 0 || p.del > 0;
				return { p: p, rs: rs, max: max, signal: signal };
			})
			.filter(function (x) {
				return query
					? x.p.key.toLowerCase().indexOf(query) !== -1
					: true;
			})
			.filter(function (x) {
				return state.seg === 'changed'
					? x.signal
					: state.seg === 'clean'
						? !x.signal
						: true;
			})
			.sort(function (a, b) {
				return (
					b.max - a.max ||
					b.p.add + b.p.del - (a.p.add + a.p.del) ||
					a.p.key.localeCompare(b.p.key)
				);
			});
	}

	/**
	 * Reflect the current filter state onto the segmented control buttons.
	 *
	 * @param {object} state The overview state.
	 */
	function syncToolbar(state) {
		Object.keys(state.segButtons).forEach(function (s) {
			state.segButtons[s].setAttribute(
				'aria-pressed',
				state.seg === s ? 'true' : 'false'
			);
		});
		Object.keys(state.vpButtons).forEach(function (name) {
			state.vpButtons[name].setAttribute(
				'aria-pressed',
				state.vpf === name ? 'true' : 'false'
			);
		});
	}

	/**
	 * (Re)render just the page list for the current filters and selection.
	 *
	 * @param {object} state The overview state.
	 */
	function renderList(state) {
		syncToolbar(state);
		var rows = computeRows(state);
		state.rows = rows;

		if (state.initSel) {
			var found = rows.findIndex(function (x) {
				return x.p.key === lastPage;
			});
			state.sel = Math.max(0, found);
			state.initSel = false;
		}
		state.sel = Math.min(
			Math.max(0, state.sel),
			Math.max(0, rows.length - 1)
		);

		var listWrap = state.listWrap;
		listWrap.innerHTML = '';
		state.cards = [];

		if (rows.length === 0) {
			listWrap.appendChild(
				h('div', {
					class: 'empty',
					text: 'Nothing matches these filters.',
				})
			);
			return;
		}

		var pagelist = h('div', { class: 'pagelist' });
		rows.forEach(function (row, i) {
			var wi = worstIdx(row.rs);
			var vi = i === state.sel && state.selVp >= 0 ? state.selVp : wi;
			var cls =
				'pcard' +
				(i === state.sel ? ' sel' : '') +
				(row.signal ? '' : ' clean');

			var main = h('div', { class: 'main' });
			if (row.max > 0) {
				main.appendChild(
					h('span', { class: 'thumb' }, [
						h('img', {
							src: row.rs[wi].img.diff,
							alt: '',
							loading: 'lazy',
						}),
					])
				);
			}
			main.appendChild(
				h('div', { class: 'names' }, [
					h('div', { class: 'key', text: row.p.key }),
					h('div', { class: 'path', text: row.p.url }),
				])
			);

			var side = h('div', { class: 'side' }, [
				htmlCount(row.p.add, row.p.del),
				h('span', {
					class: 'maxbadge sev-' + sev(row.max),
					text: row.max > 0 ? fmt(row.max) : 'clean',
				}),
			]);

			var chiprow = h(
				'div',
				{ class: 'chiprow' },
				row.rs.map(function (r, ri) {
					return h(
						'button',
						{
							class:
								'vpchip' +
								(i === state.sel && ri === vi ? ' selvp' : ''),
							title:
								'Open ' +
								r.vp +
								' comparison (' +
								vpMeta(r.vp) +
								')',
							onclick: function (e) {
								e.stopPropagation();
								go({ v: 'cmp', p: row.p.key, vp: r.vp });
							},
						},
						[
							r.vp,
							h('span', {
								class: 'pct ' + sev(r.diff),
								text: r.diff > 0 ? fmt(r.diff) : '✓',
							}),
						]
					);
				})
			);

			var card = h(
				'div',
				{
					class: cls,
					onclick: function () {
						go({ v: 'cmp', p: row.p.key, vp: row.rs[wi].vp });
					},
				},
				[main, side, chiprow]
			);
			state.cards[i] = card;
			pagelist.appendChild(card);
		});
		listWrap.appendChild(pagelist);

		scrollSelIntoView(state);
	}

	/**
	 * Scroll the selected card into a comfortable position without jumping.
	 *
	 * @param {object} state The overview state.
	 */
	function scrollSelIntoView(state) {
		var el = state.cards[state.sel];
		if (!el) {
			return;
		}
		var r = el.getBoundingClientRect();
		if (r.top < 130 || r.bottom > window.innerHeight - 70) {
			window.scrollBy({
				top: r.top - window.innerHeight / 2.4,
				behavior: reduceMotion ? 'auto' : 'smooth',
			});
		}
	}

	/**
	 * The currently selected page/viewport target (worst viewport by default).
	 *
	 * @param {object} state The overview state.
	 * @returns {object|null} `{ page, vp }`, or null when the list is empty.
	 */
	function currentTarget(state) {
		var row = state.rows[state.sel];
		if (!row) {
			return null;
		}
		var vi = state.selVp >= 0 ? state.selVp : worstIdx(row.rs);
		return { page: row.p, vp: row.rs[vi].vp };
	}

	/**
	 * Handle keyboard input while the overview is active.
	 *
	 * @param {KeyboardEvent} e     The key event.
	 * @param {object}        state The overview state.
	 */
	function overviewKey(e, state) {
		var count = state.rows.length;
		if (e.key === 'j' || e.key === 'ArrowDown') {
			e.preventDefault();
			state.sel = Math.min(state.sel + 1, count - 1);
			state.selVp = -1;
			renderList(state);
		} else if (e.key === 'k' || e.key === 'ArrowUp') {
			e.preventDefault();
			state.sel = Math.max(state.sel - 1, 0);
			state.selVp = -1;
			renderList(state);
		} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			var row = state.rows[state.sel];
			if (!row) {
				return;
			}
			var n = row.rs.length;
			var cur = state.selVp >= 0 ? state.selVp : worstIdx(row.rs);
			state.selVp =
				(((cur + (e.key === 'ArrowRight' ? 1 : -1)) % n) + n) % n;
			renderList(state);
		} else if (e.key === 'Enter') {
			var t1 = currentTarget(state);
			if (t1) {
				go({ v: 'cmp', p: t1.page.key, vp: t1.vp });
			}
		} else if (e.key === 'h') {
			var t2 = currentTarget(state);
			if (t2) {
				go({ v: 'html', p: t2.page.key, vp: t2.vp });
			}
		} else if (e.key === ' ') {
			e.preventDefault();
			var t3 = currentTarget(state);
			if (!t3) {
				return;
			}
			var list = changedQueue();
			var idx = list.findIndex(function (x) {
				return x.page.key === t3.page.key && x.vp === t3.vp;
			});
			if (idx < 0) {
				idx = list.findIndex(function (x) {
					return x.page.key === t3.page.key;
				});
			}
			if (idx >= 0) {
				openQuickLook(idx);
			}
		} else if (e.key === '/') {
			e.preventDefault();
			state.searchInput.focus();
		} else if (e.key === 'f') {
			state.seg =
				state.seg === 'changed'
					? 'all'
					: state.seg === 'all'
						? 'clean'
						: 'changed';
			renderList(state);
		}
	}

	/* ============ comparison view ============ */

	var CMP_MODES = [
		{ id: 'swipe', label: 'Swipe', key: '1' },
		{ id: 'side', label: 'Side by side', key: '2' },
		{ id: 'onion', label: 'Onion skin', key: '3' },
		{ id: 'diff', label: 'Diff', key: '4' },
		{ id: 'blink', label: 'Blink', key: '5' },
	];

	/**
	 * A banner shown when an image on screen was downscaled to fit the
	 * browser's image-decode limit (~32,767px per side). The capture and the
	 * pixel diff are still full resolution on disk; only what's painted here
	 * is shrunk.
	 *
	 * @param {object} scaled The result's `scaled` map (`{ control?, capture?,
	 *                        diff? }`, each `{ from:[w,h], to:[w,h] }`).
	 * @param {string} mode   The active compare mode.
	 * @returns {HTMLElement} The banner node.
	 */
	function scaledNotice(scaled, mode) {
		// In diff mode the diff image is what's on screen; every other mode
		// shows the baseline/current pair.
		var info =
			mode === 'diff'
				? scaled.diff || scaled.capture || scaled.control
				: scaled.capture || scaled.control || scaled.diff;
		var from = info.from;
		var to = info.to;
		var pct = Math.round((to[1] / from[1]) * 100);
		return h('div', { class: 'scalednote', role: 'note' }, [
			h('span', { class: 'scalednote-tag', text: 'Downscaled' }),
			h('span', {
				class: 'scalednote-text',
				text:
					'Too tall for the browser to render at full size — shown at ' +
					pct +
					'% (' +
					from[0] +
					'×' +
					from[1] +
					'px → ' +
					to[0] +
					'×' +
					to[1] +
					'px). Pixel differences are still measured at full resolution.',
			}),
		]);
	}

	/**
	 * Render the comparison view for a route, in the persisted compare mode.
	 *
	 * @param {object} route The route descriptor (`{ p, vp }`).
	 */
	function renderCompare(route) {
		var page = pageFor(route.p);
		var vp = resolveVp(page, route.vp);
		var r = page.results[vp];
		var img = r.img;

		var mode = sessionStorage.getItem('rg-mode') || 'swipe';
		if (
			!CMP_MODES.some(function (m) {
				return m.id === mode;
			})
		) {
			mode = 'swipe';
		}

		var queue = changedQueue();
		var qi = queue.findIndex(function (x) {
			return x.page.key === page.key && x.vp === vp;
		});

		// Step through the worst-first changed queue, wrapping at the ends.
		var step = function (d) {
			if (!queue.length) {
				return;
			}
			var i =
				qi < 0
					? 0
					: (((qi + d) % queue.length) + queue.length) % queue.length;
			go({ v: 'cmp', p: queue[i].page.key, vp: queue[i].vp });
		};

		// Cycle to the next/previous viewport of the same page.
		var cycleVp = function (d) {
			var names = VPS.map(function (v) {
				return v.name;
			});
			var i = names.indexOf(vp);
			go({
				v: 'cmp',
				p: page.key,
				vp: names[
					(((i + d) % names.length) + names.length) % names.length
				],
			});
		};

		// Persist and switch compare mode (a full re-render of this view).
		var setMode = function (m) {
			sessionStorage.setItem('rg-mode', m);
			render();
		};

		/* ----- top bars ----- */

		var bar1 = h('header', { class: 'cmp-bar' }, [
			h('button', {
				class: 'ghost-btn icon-btn',
				'aria-label': 'Back to overview',
				text: '←',
				onclick: function () {
					go({ v: 'overview' });
				},
			}),
			h('div', { class: 'cmp-title' }, [
				h('b', { text: page.key }),
				h('span', { class: 'meta', text: vp + ' · ' + vpMeta(vp) }),
			]),
			h('span', {
				class: 'maxbadge sev-' + sev(r.diff),
				text:
					r.diff > 0
						? fmt(r.diff) + ' different'
						: 'no visual change',
			}),
			h('span', { class: 'topbar-spacer' }),
		]);
		if (queue.length > 0) {
			bar1.appendChild(
				h('span', { class: 'modectl' }, [
					qi >= 0
						? qi + 1 + ' of ' + queue.length + ' changed'
						: queue.length + ' changed',
					h('button', {
						class: 'ghost-btn icon-btn',
						title: 'Previous changed (p)',
						text: '↑',
						onclick: function () {
							step(-1);
						},
					}),
					h('button', {
						class: 'ghost-btn icon-btn',
						title: 'Next changed (n)',
						text: '↓',
						onclick: function () {
							step(1);
						},
					}),
				])
			);
		}
		var htmlBtn = h('button', {
			class: 'ghost-btn',
			onclick: function () {
				go({ v: 'html', p: page.key, vp: vp });
			},
		});
		append(htmlBtn, ['HTML ', htmlCount(r.add, r.del)]);
		bar1.appendChild(htmlBtn);

		var modeSeg = h(
			'div',
			{ class: 'seg', role: 'group', 'aria-label': 'Compare mode' },
			CMP_MODES.map(function (m) {
				return h('button', {
					'aria-pressed': mode === m.id ? 'true' : 'false',
					title: m.label + ' (' + m.key + ')',
					text: m.label,
					onclick: function () {
						setMode(m.id);
					},
				});
			})
		);

		var vptabs = h(
			'div',
			{ class: 'vptabs', role: 'group', 'aria-label': 'Viewport' },
			VPS.filter(function (v) {
				return page.results[v.name];
			}).map(function (v) {
				var rr = page.results[v.name];
				return h(
					'button',
					{
						class: 'vptab',
						'aria-pressed': v.name === vp ? 'true' : 'false',
						onclick: function () {
							go({ v: 'cmp', p: page.key, vp: v.name });
						},
					},
					[
						v.name,
						h('span', {
							class: 'pct ' + sev(rr.diff),
							text: rr.diff > 0 ? fmt(rr.diff) : '✓',
						}),
					]
				);
			})
		);

		var bar2 = h('div', { class: 'cmp-sub' }, [modeSeg]);

		/* ----- stage + mode control ----- */

		var stage = h('div', {
			class: 'stage' + (mode === 'side' ? ' wide' : ''),
		});

		if (mode === 'swipe') {
			viewKey = makeCompareKey({
				setMode: setMode,
				mode: mode,
				step: step,
				cycleVp: cycleVp,
				page: page,
				vp: vp,
				adjust: buildSwipe(stage, img),
			});
		} else if (mode === 'side') {
			buildSide(stage, img);
			viewKey = makeCompareKey({
				setMode: setMode,
				mode: mode,
				step: step,
				cycleVp: cycleVp,
				page: page,
				vp: vp,
			});
		} else if (mode === 'onion') {
			viewKey = makeCompareKey({
				setMode: setMode,
				mode: mode,
				step: step,
				cycleVp: cycleVp,
				page: page,
				vp: vp,
				adjust: buildOnion(stage, bar2, img),
			});
		} else if (mode === 'diff') {
			viewKey = makeCompareKey({
				setMode: setMode,
				mode: mode,
				step: step,
				cycleVp: cycleVp,
				page: page,
				vp: vp,
				adjust: buildDiff(stage, bar2, img, page, vp),
			});
		} else if (mode === 'blink') {
			var blink = buildBlink(stage, bar2, img);
			blink.setPlaying(true);
			viewKey = makeCompareKey({
				setMode: setMode,
				mode: mode,
				step: step,
				cycleVp: cycleVp,
				page: page,
				vp: vp,
				togglePlay: function () {
					blink.toggle();
				},
				flip: function () {
					blink.flip();
				},
				nudgeDelay: function (d) {
					blink.nudgeDelay(d);
				},
				toggleFade: function () {
					blink.toggleFade();
				},
			});
		}

		bar2.appendChild(vptabs);

		root.appendChild(bar1);
		root.appendChild(bar2);
		if (r.scaled) {
			root.appendChild(scaledNotice(r.scaled, mode));
		}
		if (r.diff === 0 && mode !== 'side') {
			root.appendChild(
				h('p', {
					class: 'cleannote',
					text: 'No pixels differ at this viewport — the images below are identical.',
				})
			);
		}
		root.appendChild(stage);
		var hints = [
			{ keys: ['1', '5'], label: 'modes' },
			{ keys: ['←', '→'], label: 'adjust' },
		];
		if (mode === 'blink') {
			hints.push(
				{ keys: ['space'], label: 'play / pause' },
				{ keys: ['[', ']'], label: 'speed' },
				{ keys: ['f'], label: 'fade' }
			);
		}
		hints.push(
			{ keys: ['n', 'p'], label: 'next / prev changed' },
			{ keys: ['v'], label: 'viewport' },
			{ keys: ['h'], label: 'HTML' },
			{ keys: ['esc'], label: 'overview' }
		);
		root.appendChild(hintbar(hints));
	}

	/**
	 * Build the swipe stage (clipped baseline over current, draggable divider).
	 *
	 * @param {HTMLElement} stage The stage container to fill.
	 * @param {object}      img   The result's image paths.
	 * @returns {Function} An `adjust(delta)` that nudges the reveal position.
	 */
	function buildSwipe(stage, img) {
		var pos = 0.5;
		var layer = h('div', { class: 'layer' }, [
			h('img', {
				src: img.control,
				alt: 'Baseline screenshot',
				// String 'false', not boolean: the h() helper drops false-valued
				// props, and draggable is an enumerated attribute anyway.
				draggable: 'false',
			}),
		]);
		var divider = h(
			'div',
			{
				class: 'divider',
				role: 'slider',
				'aria-label': 'Reveal amount: baseline versus current',
				'aria-valuemin': '0',
				'aria-valuemax': '100',
				'aria-valuenow': '50',
			},
			[h('div', { class: 'handle', text: '↔' })]
		);
		var setPos = function (p) {
			pos = clamp01(p);
			layer.style.clipPath = 'inset(0 ' + (1 - pos) * 100 + '% 0 0)';
			divider.style.left = pos * 100 + '%';
			divider.setAttribute(
				'aria-valuenow',
				String(Math.round(pos * 100))
			);
		};
		var dragging = false;
		var shot = h('div', { class: 'shot swipe-stage' }, [
			h('img', {
				src: img.capture,
				alt: 'Current screenshot',
				draggable: 'false',
			}),
			layer,
			divider,
			h('span', { class: 'taglabel l', text: 'baseline' }),
			h('span', { class: 'taglabel r', text: 'current' }),
		]);
		var posFromEvent = function (e) {
			var rect = shot.getBoundingClientRect();
			return clamp01((e.clientX - rect.left) / rect.width);
		};
		var endDrag = function (e) {
			dragging = false;
			// Release capture so the stage stops receiving pointer events once
			// the gesture is over.
			if (e && shot.hasPointerCapture(e.pointerId)) {
				shot.releasePointerCapture(e.pointerId);
			}
		};
		shot.addEventListener('pointerdown', function (e) {
			// Primary button / touch / pen only — ignore right- and middle-click.
			if (e.button !== 0) {
				return;
			}
			// Suppress the browser's native image drag and text selection, which
			// would otherwise hijack the gesture and fire pointercancel instead
			// of pointerup, leaving the divider stuck to the cursor.
			e.preventDefault();
			dragging = true;
			shot.setPointerCapture(e.pointerId);
			setPos(posFromEvent(e));
		});
		shot.addEventListener('pointermove', function (e) {
			if (dragging) {
				setPos(posFromEvent(e));
			}
		});
		// End on up and on cancel/lost-capture, so an interrupted gesture can
		// never leave dragging stuck on.
		shot.addEventListener('pointerup', endDrag);
		shot.addEventListener('pointercancel', endDrag);
		shot.addEventListener('lostpointercapture', function () {
			dragging = false;
		});
		stage.appendChild(shot);
		setPos(pos);
		return function (d) {
			setPos(pos + d);
		};
	}

	/**
	 * Build the side-by-side stage.
	 *
	 * @param {HTMLElement} stage The stage container to fill.
	 * @param {object}      img   The result's image paths.
	 */
	function buildSide(stage, img) {
		stage.appendChild(
			h('div', { class: 'sbs' }, [
				h('figure', {}, [
					h('figcaption', {
						text: 'baseline · ' + (R.baselineAt || ''),
					}),
					h('div', { class: 'shot' }, [
						h('img', {
							src: img.control,
							alt: 'Baseline screenshot',
						}),
					]),
				]),
				h('figure', {}, [
					h('figcaption', {
						text: 'current · ' + (R.comparedAt || ''),
					}),
					h('div', { class: 'shot' }, [
						h('img', {
							src: img.capture,
							alt: 'Current screenshot',
						}),
					]),
				]),
			])
		);
	}

	/**
	 * Build the onion-skin stage and its opacity control.
	 *
	 * @param {HTMLElement} stage The stage container to fill.
	 * @param {HTMLElement} bar2  The mode-control bar.
	 * @param {object}      img   The result's image paths.
	 * @returns {Function} An `adjust(delta)` that nudges the baseline opacity.
	 */
	function buildOnion(stage, bar2, img) {
		var value = 0.5;
		var layer = h('div', { class: 'layer', style: { opacity: '0.5' } }, [
			h('img', { src: img.control, alt: 'Baseline screenshot' }),
		]);
		var labelL = h('span', { class: 'taglabel l', text: 'baseline 50%' });
		var labelR = h('span', { class: 'taglabel r', text: 'current 50%' });
		var range = h('input', {
			type: 'range',
			min: '0',
			max: '1',
			step: '0.01',
			value: '0.5',
		});
		var apply = function (v) {
			value = clamp01(v);
			layer.style.opacity = String(value);
			labelL.textContent = 'baseline ' + Math.round(value * 100) + '%';
			labelR.textContent =
				'current ' + Math.round((1 - value) * 100) + '%';
			range.value = String(value);
		};
		range.addEventListener('input', function (e) {
			apply(+e.target.value);
		});
		bar2.appendChild(
			h('label', { class: 'modectl' }, ['Baseline opacity', range])
		);
		stage.appendChild(
			h('div', { class: 'shot' }, [
				h('img', { src: img.capture, alt: 'Current screenshot' }),
				layer,
				labelL,
				labelR,
			])
		);
		return function (d) {
			apply(value + d);
		};
	}

	/**
	 * Build the diff-overlay stage and its opacity control.
	 *
	 * @param {HTMLElement} stage The stage container to fill.
	 * @param {HTMLElement} bar2  The mode-control bar.
	 * @param {object}      img   The result's image paths.
	 * @param {object}      page  The page (for the diff alt text).
	 * @param {string}      vp    The viewport name (for the diff alt text).
	 * @returns {Function} An `adjust(delta)` that nudges the diff opacity.
	 */
	function buildDiff(stage, bar2, img, page, vp) {
		var value = 1;
		var layer = h('div', { class: 'layer', style: { opacity: '1' } }, [
			h('img', {
				src: img.diff,
				alt:
					'Diff of ' +
					page.key +
					' at ' +
					vp +
					': changed pixels in red',
			}),
		]);
		var range = h('input', {
			type: 'range',
			min: '0',
			max: '1',
			step: '0.01',
			value: '1',
		});
		var apply = function (v) {
			value = clamp01(v);
			layer.style.opacity = String(value);
			range.value = String(value);
		};
		range.addEventListener('input', function (e) {
			apply(+e.target.value);
		});
		bar2.appendChild(
			h('label', { class: 'modectl' }, ['Diff opacity', range])
		);
		stage.appendChild(
			h('div', { class: 'shot' }, [
				h('img', { src: img.capture, alt: 'Current screenshot' }),
				layer,
				h('span', {
					class: 'taglabel r',
					text: 'diff · changed pixels in red',
				}),
			])
		);
		return function (d) {
			apply(value + d);
		};
	}

	// Blink dwell time (ms each image is held) and crossfade preference persist
	// across slugs and reloads so a chosen rhythm sticks while triaging.
	var BLINK_MIN = 100;
	var BLINK_MAX = 3000;
	var BLINK_STEP = 50;

	/**
	 * Read the saved blink dwell, clamped to the supported range.
	 *
	 * @returns {number} The dwell in milliseconds.
	 */
	function blinkDelay() {
		var saved = parseInt(sessionStorage.getItem('rg-blink-delay'), 10);
		var ms = Number.isFinite(saved) ? saved : 650;
		return Math.max(BLINK_MIN, Math.min(BLINK_MAX, ms));
	}

	/**
	 * Build the blink stage and its play/pause, speed, and fade controls.
	 *
	 * Stacks the baseline over the current image and alternates which is
	 * opaque. The dwell time is adjustable (slider or `[` / `]`); an optional
	 * crossfade (`f`) eases between the two rather than hard-cutting, which can
	 * make a small shift easier to spot than an abrupt swap.
	 *
	 * @param {HTMLElement} stage The stage container to fill.
	 * @param {HTMLElement} bar2  The mode-control bar.
	 * @param {object}      img   The result's image paths.
	 * @returns {object} `{ setPlaying, toggle, flip, nudgeDelay, toggleFade }`.
	 */
	function buildBlink(stage, bar2, img) {
		var showBase = false;
		var playing = true;
		var delay = blinkDelay();
		var fade = sessionStorage.getItem('rg-blink-fade') === '1';

		var layer = h('div', { class: 'layer blink-layer' }, [
			h('img', { src: img.control, alt: 'Baseline screenshot' }),
		]);
		var label = h('span', { class: 'taglabel l', text: 'current' });
		var readout = h('b', {
			style: { color: 'var(--text)' },
			text: 'current',
		});
		var playBtn = h('button', { class: 'ghost-btn', text: 'Pause' });
		var slider = h('input', {
			type: 'range',
			min: String(BLINK_MIN),
			max: String(BLINK_MAX),
			step: String(BLINK_STEP),
			value: String(delay),
			'aria-label': 'Blink dwell time in milliseconds',
		});
		var delayOut = h('span', {
			class: 'blink-delay',
			text: delay + 'ms',
		});
		var fadeBtn = h('button', {
			class: 'ghost-btn',
			text: 'Fade',
			'aria-pressed': fade ? 'true' : 'false',
			title: 'Crossfade between images (f)',
		});

		// Ease no longer than half the dwell so each image still reaches its
		// own full opacity before the next swap starts.
		var applyFade = function () {
			layer.style.transition = fade
				? 'opacity ' + Math.min(delay / 2, 400) + 'ms linear'
				: 'none';
		};
		var setShowBase = function (b) {
			showBase = b;
			layer.style.opacity = b ? '1' : '0';
			label.textContent = b ? 'baseline' : 'current';
			readout.textContent = b ? 'baseline' : 'current';
		};
		var setPlaying = function (p) {
			playing = p;
			playBtn.textContent = p ? 'Pause' : 'Play';
			if (blinkTimer) {
				clearInterval(blinkTimer);
				blinkTimer = null;
			}
			if (p) {
				blinkTimer = setInterval(function () {
					setShowBase(!showBase);
				}, delay);
			}
		};
		var setDelay = function (ms) {
			delay = Math.max(BLINK_MIN, Math.min(BLINK_MAX, ms));
			sessionStorage.setItem('rg-blink-delay', String(delay));
			delayOut.textContent = delay + 'ms';
			slider.value = String(delay);
			applyFade();
			// Restart the interval so a change takes effect immediately.
			if (playing) {
				setPlaying(true);
			}
		};
		var setFade = function (on) {
			fade = on;
			sessionStorage.setItem('rg-blink-fade', on ? '1' : '0');
			fadeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
			applyFade();
		};

		playBtn.addEventListener('click', function () {
			setPlaying(!playing);
		});
		slider.addEventListener('input', function () {
			setDelay(parseInt(slider.value, 10));
		});
		fadeBtn.addEventListener('click', function () {
			setFade(!fade);
		});

		applyFade();
		setShowBase(false);

		bar2.appendChild(
			h('span', { class: 'modectl' }, [
				playBtn,
				'showing: ',
				readout,
				h('span', { class: 'modectl-div' }),
				'speed',
				slider,
				delayOut,
				fadeBtn,
			])
		);
		stage.appendChild(
			h('div', { class: 'shot' }, [
				h('img', { src: img.capture, alt: 'Current screenshot' }),
				layer,
				label,
			])
		);
		return {
			setPlaying: setPlaying,
			toggle: function () {
				setPlaying(!playing);
			},
			flip: function () {
				setPlaying(false);
				setShowBase(!showBase);
			},
			nudgeDelay: function (d) {
				setDelay(delay + d * BLINK_STEP);
			},
			toggleFade: function () {
				setFade(!fade);
			},
		};
	}

	/**
	 * Build the key handler shared by every compare mode.
	 *
	 * @param {object} ctx Mode context: `{ setMode, mode, step, cycleVp, page,
	 *                     vp, adjust?, togglePlay?, flip? }`.
	 * @returns {Function} The key handler.
	 */
	function makeCompareKey(ctx) {
		return function (e) {
			var m = CMP_MODES.find(function (x) {
				return x.key === e.key;
			});
			if (m) {
				ctx.setMode(m.id);
				return;
			}
			if (e.key === 'Escape' || e.key === 'b') {
				go({ v: 'overview' });
			} else if (e.key === 'n') {
				ctx.step(1);
			} else if (e.key === 'p') {
				ctx.step(-1);
			} else if (e.key === 'v') {
				ctx.cycleVp(e.shiftKey ? -1 : 1);
			} else if (e.key === 'h') {
				go({ v: 'html', p: ctx.page.key, vp: ctx.vp });
			} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				if (ctx.mode === 'blink') {
					if (ctx.flip) {
						ctx.flip();
					}
					return;
				}
				var d =
					(e.key === 'ArrowRight' ? 1 : -1) *
					(e.shiftKey ? 0.1 : 0.02);
				if (ctx.adjust) {
					ctx.adjust(d);
				}
			} else if (e.key === ' ' && ctx.mode === 'blink') {
				e.preventDefault();
				if (ctx.togglePlay) {
					ctx.togglePlay();
				}
			} else if (
				(e.key === '[' || e.key === ']') &&
				ctx.mode === 'blink'
			) {
				e.preventDefault();
				if (ctx.nudgeDelay) {
					ctx.nudgeDelay(e.key === ']' ? 1 : -1);
				}
			} else if (e.key === 'f' && ctx.mode === 'blink') {
				e.preventDefault();
				if (ctx.toggleFade) {
					ctx.toggleFade();
				}
			}
		};
	}

	/* ============ HTML diff view ============ */

	/**
	 * Render the unified HTML diff view for a route.
	 *
	 * @param {object} route The route descriptor (`{ p, vp }`).
	 */
	function renderHtmlDiff(route) {
		var page = pageFor(route.p);
		var vp = resolveVp(page, route.vp);
		var r = page.results[vp];
		var hasChanges = r.add > 0 || r.del > 0;

		viewKey = function (e) {
			if (e.key === 'Escape' || e.key === 'b') {
				go({ v: 'overview' });
			} else if (e.key === 'c') {
				go({ v: 'cmp', p: page.key, vp: vp });
			}
		};

		var bar = h('header', { class: 'cmp-bar' }, [
			h('button', {
				class: 'ghost-btn icon-btn',
				'aria-label': 'Back to overview',
				text: '←',
				onclick: function () {
					go({ v: 'overview' });
				},
			}),
			h('div', { class: 'cmp-title' }, [
				h('b', { text: page.key }),
				h('span', {
					class: 'meta',
					text: 'HTML diff · ' + vp + ' · ' + vpMeta(vp),
				}),
			]),
			htmlCount(r.add, r.del),
			h('span', { class: 'topbar-spacer' }),
			h('button', {
				class: 'ghost-btn',
				text: 'Visual comparison',
				onclick: function () {
					go({ v: 'cmp', p: page.key, vp: vp });
				},
			}),
		]);

		var panel = h('div', { class: 'hd-panel' });
		if (r.note) {
			panel.appendChild(h('div', { class: 'hd-empty', text: r.note }));
		} else if (hasChanges) {
			panel.appendChild(renderHunks(r.htmlDiff));
		} else {
			panel.appendChild(
				h('div', {
					class: 'hd-empty',
					text: 'The HTML of this page is identical to the baseline.',
				})
			);
		}

		root.appendChild(bar);
		root.appendChild(h('div', { class: 'hd-wrap' }, [panel]));
		root.appendChild(
			hintbar([
				{ keys: ['c'], label: 'visual comparison' },
				{ keys: ['esc'], label: 'overview' },
				{ keys: ['?'], label: 'shortcuts' },
			])
		);
	}

	/**
	 * Render the diff table body from hunk JSON.
	 *
	 * @param {Array} hunks The hunks (`{ o, n, ctx, lines }` and `{ gap }`).
	 * @returns {HTMLElement} The diff table.
	 */
	function renderHunks(hunks) {
		var tbody = h('tbody');
		(hunks || []).forEach(function (item) {
			if (item.gap) {
				tbody.appendChild(
					h('tr', { class: 'hd-gap' }, [
						h('td', {
							colspan: '4',
							text:
								'· · ·  ' +
								item.gap +
								' unchanged lines  · · ·',
						}),
					])
				);
				return;
			}
			tbody.appendChild(
				h('tr', { class: 'hd-hunk' }, [
					h('td', {
						colspan: '4',
						text:
							'@@ −' +
							item.o +
							' +' +
							item.n +
							' @@' +
							(item.ctx ? ' ' + item.ctx : ''),
					}),
				])
			);
			var o = item.o;
			var n = item.n;
			item.lines.forEach(function (pair) {
				var t = pair[0];
				var s = pair[1];
				var cls = t === '+' ? 'hd-add' : t === '-' ? 'hd-del' : '';
				tbody.appendChild(
					h('tr', { class: cls }, [
						h('td', {
							class: 'hd-num',
							text: t === '+' ? '' : String(o),
						}),
						h('td', {
							class: 'hd-num',
							text: t === '-' ? '' : String(n),
						}),
						h('td', { class: 'hd-sign', text: t === ' ' ? '' : t }),
						h('td', { class: 'hd-code', text: s }),
					])
				);
				if (t !== '+') {
					o++;
				}
				if (t !== '-') {
					n++;
				}
			});
		});
		return h('table', { class: 'hd-table' }, [tbody]);
	}

	/* ============ quick look overlay ============ */

	var qlEl = null;
	var qlLastFocus = null;

	/**
	 * Open the quick-look overlay at a position in the changed queue.
	 *
	 * @param {number} i The queue index.
	 */
	function openQuickLook(i) {
		ql = i;
		qlLastFocus = document.activeElement;
		renderQuickLook();
	}

	/**
	 * Close the quick-look overlay and restore focus.
	 */
	function closeQuickLook() {
		ql = null;
		if (qlEl) {
			qlEl.remove();
			qlEl = null;
		}
		if (qlLastFocus && qlLastFocus.focus) {
			qlLastFocus.focus();
		}
	}

	/**
	 * (Re)render the quick-look overlay for the current queue index.
	 */
	function renderQuickLook() {
		var list = changedQueue();
		var x = list[ql];
		if (!x) {
			closeQuickLook();
			return;
		}
		if (qlEl) {
			qlEl.remove();
		}
		var closeBtn = h('button', {
			class: 'ghost-btn icon-btn',
			'aria-label': 'Close quick look',
			text: '×',
			onclick: closeQuickLook,
		});
		var dialog = h(
			'div',
			{
				class: 'ql',
				role: 'dialog',
				'aria-modal': 'true',
				'aria-label': 'Diff quick look',
			},
			[
				h('div', { class: 'ql-head' }, [
					h('b', { text: x.page.key }),
					h('span', {
						class: 'meta',
						text: x.vp + ' · ' + vpMeta(x.vp),
					}),
					h('span', {
						class: 'maxbadge sev-' + sev(x.r.diff),
						text: fmt(x.r.diff),
					}),
					h('span', { class: 'topbar-spacer' }),
					h('span', {
						class: 'meta',
						text: ql + 1 + ' of ' + list.length + ' changed',
					}),
					closeBtn,
				]),
				h('div', { class: 'ql-body' }, [
					h('img', {
						src: x.r.img.diff,
						alt:
							'Diff of ' +
							x.page.key +
							' at ' +
							x.vp +
							': changed pixels in red',
					}),
				]),
				h('div', { class: 'ql-foot' }, [
					h('span', {}, [kbd('←'), kbd('→'), ' next changed']),
					h('span', {}, [kbd('↵'), ' open full comparison']),
					h('span', {}, [kbd('esc'), ' close']),
				]),
			]
		);
		qlEl = h(
			'div',
			{
				class: 'overlay',
				onclick: function (e) {
					if (e.target === e.currentTarget) {
						closeQuickLook();
					}
				},
			},
			[dialog]
		);
		trapFocus(qlEl);
		document.body.appendChild(qlEl);
		closeBtn.focus();
	}

	/* ============ shortcuts overlay ============ */

	var HELP = {
		overview: [
			['Navigate pages', ['j', 'k']],
			['Pick viewport', ['←', '→']],
			['Open comparison', ['↵']],
			['Quick look diff', ['space']],
			['Open HTML diff', ['h']],
			['Focus filter', ['/']],
			['Cycle change filter', ['f']],
		],
		cmp: [
			['Swipe / Side / Onion / Diff / Blink', ['1', '5']],
			['Adjust slider / flip blink', ['←', '→']],
			['Play / pause blink', ['space']],
			['Blink speed (slower / faster)', ['[', ']']],
			['Toggle blink crossfade', ['f']],
			['Next / prev changed result', ['n', 'p']],
			['Cycle viewport', ['v']],
			['HTML diff', ['h']],
			['Back to overview', ['esc']],
		],
		html: [
			['Visual comparison', ['c']],
			['Back to overview', ['esc']],
		],
	};

	var helpEl = null;
	var helpLastFocus = null;

	/**
	 * Open the keyboard-shortcuts overlay for the current view.
	 */
	function openHelp() {
		helpOpen = true;
		helpLastFocus = document.activeElement;
		var rows = HELP[parseHash().v] || HELP.overview;
		var dialog = h(
			'div',
			{
				class: 'help',
				role: 'dialog',
				'aria-modal': 'true',
				'aria-label': 'Keyboard shortcuts',
				tabindex: '-1',
			},
			[
				h('h2', { text: 'Keyboard shortcuts' }),
				h('p', {
					class: 'note',
					text: 'Reglance is built for keyboard triage — hands stay on home row from first row to last diff.',
				}),
				h(
					'div',
					{ class: 'grid' },
					rows.map(function (row) {
						return h('div', { class: 'row' }, [
							h('span', { text: row[0] }),
							h(
								'span',
								{ class: 'keys' },
								row[1].map(function (k) {
									return kbd(k);
								})
							),
						]);
					})
				),
			]
		);
		helpEl = h(
			'div',
			{
				class: 'overlay',
				onclick: function (e) {
					if (e.target === e.currentTarget) {
						closeHelp();
					}
				},
			},
			[dialog]
		);
		trapFocus(helpEl);
		document.body.appendChild(helpEl);
		dialog.focus();
	}

	/**
	 * Close the shortcuts overlay and restore focus.
	 */
	function closeHelp() {
		helpOpen = false;
		if (helpEl) {
			helpEl.remove();
			helpEl = null;
		}
		if (helpLastFocus && helpLastFocus.focus) {
			helpLastFocus.focus();
		}
	}

	/**
	 * Keep Tab focus inside a dialog container.
	 *
	 * @param {HTMLElement} container The dialog overlay.
	 */
	function trapFocus(container) {
		container.addEventListener('keydown', function (e) {
			if (e.key !== 'Tab') {
				return;
			}
			var f = container.querySelectorAll(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			if (!f.length) {
				return;
			}
			var first = f[0];
			var last = f[f.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		});
	}

	/* ============ global keyboard dispatch ============ */

	window.addEventListener('keydown', function (e) {
		if (e.metaKey || e.ctrlKey || e.altKey) {
			return;
		}
		var tag = e.target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
			return;
		}
		if (e.key === '?') {
			if (helpOpen) {
				closeHelp();
			} else {
				openHelp();
			}
			return;
		}
		if (helpOpen) {
			if (e.key === 'Escape') {
				closeHelp();
			}
			return;
		}
		if (ql !== null) {
			var list = changedQueue();
			if (e.key === 'Escape') {
				closeQuickLook();
			} else if (e.key === 'ArrowRight' || e.key === 'j') {
				ql = (ql + 1) % list.length;
				renderQuickLook();
			} else if (e.key === 'ArrowLeft' || e.key === 'k') {
				ql = (ql - 1 + list.length) % list.length;
				renderQuickLook();
			} else if (e.key === 'Enter') {
				var x = list[ql];
				closeQuickLook();
				go({ v: 'cmp', p: x.page.key, vp: x.vp });
			}
			e.preventDefault();
			return;
		}
		if (viewKey) {
			viewKey(e);
		}
	});

	/* ============ boot ============ */

	var initial = parseHash();
	if (initial.p) {
		lastPage = initial.p;
	}
	render();
})();
