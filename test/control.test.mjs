import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { control } from '../src/control.mjs';

/**
 * Build a normalized config backed by a fresh temp output directory.
 *
 * @param {object} [paths] - The paths map for the config.
 * @returns {object} The normalized config.
 */
function tempConfig(paths = { home: '/' }) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reglance-test-'));
	const configPath = path.join(dir, 'reglance.json');
	fs.writeFileSync(
		configPath,
		JSON.stringify({
			domain: 'site.test',
			paths,
			output: path.join(dir, '.reglance'),
		})
	);
	return loadConfig({ configPath });
}

test('control moves captures into controls', () => {
	const config = tempConfig();
	const { dirs } = config;

	fs.mkdirSync(dirs.captures, { recursive: true });
	fs.mkdirSync(dirs.capturesHtml, { recursive: true });
	fs.writeFileSync(path.join(dirs.captures, 'home-desktop.png'), 'png');
	fs.writeFileSync(path.join(dirs.capturesHtml, 'home-desktop.html'), '<p>');
	fs.writeFileSync(path.join(dirs.captures, 'home-mobile.png'), 'png');
	fs.writeFileSync(path.join(dirs.capturesHtml, 'home-mobile.html'), '<p>');

	control(config);

	// Images and HTML land in controls...
	assert.ok(fs.existsSync(path.join(dirs.controls, 'home-desktop.png')));
	assert.ok(fs.existsSync(path.join(dirs.controlsHtml, 'home-desktop.html')));
	assert.ok(fs.existsSync(path.join(dirs.controls, 'home-mobile.png')));

	// ...and are moved, not copied — the capture is gone afterward.
	assert.ok(!fs.existsSync(path.join(dirs.captures, 'home-desktop.png')));
});

test('control skips slugs with no capture', () => {
	const config = tempConfig({ home: '/', missing: '/missing' });
	const { dirs } = config;

	fs.mkdirSync(dirs.captures, { recursive: true });
	fs.writeFileSync(path.join(dirs.captures, 'home-desktop.png'), 'png');
	fs.writeFileSync(path.join(dirs.captures, 'home-mobile.png'), 'png');

	assert.doesNotThrow(() => control(config));

	assert.ok(fs.existsSync(path.join(dirs.controls, 'home-desktop.png')));
	assert.ok(!fs.existsSync(path.join(dirs.controls, 'missing-desktop.png')));
});

test('control honors the only filter', () => {
	const config = tempConfig({ home: '/', blog: '/blog' });
	const { dirs } = config;

	fs.mkdirSync(dirs.captures, { recursive: true });
	for (const slug of [
		'home-desktop',
		'home-mobile',
		'blog-desktop',
		'blog-mobile',
	]) {
		fs.writeFileSync(path.join(dirs.captures, `${slug}.png`), 'png');
	}

	control(config, { only: ['home'] });

	assert.ok(fs.existsSync(path.join(dirs.controls, 'home-desktop.png')));
	assert.ok(!fs.existsSync(path.join(dirs.controls, 'blog-desktop.png')));
	// blog captures stay put since they were not promoted.
	assert.ok(fs.existsSync(path.join(dirs.captures, 'blog-desktop.png')));
});
