import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	shouldFailRun,
	isLocalHost,
	offDomainTargets,
	groupViewportsByScaleFactor,
	isBlockedHost,
} from '../src/capture.mjs';

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

test('offDomainTargets flags absolute-URL paths on another host', () => {
	const targets = [
		{ key: 'home', url: 'https://site.test/' },
		{ key: 'ext', url: 'https://other.test/page' },
	];
	const off = offDomainTargets(targets, 'https://site.test');
	assert.deepEqual(
		off.map((t) => t.key),
		['ext']
	);
});

test('offDomainTargets returns nothing when all targets match the domain', () => {
	const targets = [{ key: 'home', url: 'https://site.test/' }];
	assert.deepEqual(offDomainTargets(targets, 'https://site.test'), []);
});

test('offDomainTargets returns nothing without a configured domain', () => {
	const targets = [{ key: 'home', url: 'https://site.test/' }];
	assert.deepEqual(offDomainTargets(targets, null), []);
});

test('isBlockedHost matches a listed host exactly', () => {
	assert.equal(
		isBlockedHost('https://captcha.example.com/widget/v0/api.js', [
			'captcha.example.com',
		]),
		true
	);
});

test('isBlockedHost matches subdomains of a listed host', () => {
	assert.equal(
		isBlockedHost('https://sub.example.org/f83b/index.js', ['example.org']),
		true
	);
});

test('isBlockedHost does not match a host that merely ends with an entry', () => {
	// "example.com" must not block "notexample.com".
	assert.equal(
		isBlockedHost('https://notexample.com/x.js', ['example.com']),
		false
	);
});

test('isBlockedHost ignores case in the request host', () => {
	assert.equal(
		isBlockedHost('https://Captcha.Example.com/x', ['captcha.example.com']),
		true
	);
});

test('isBlockedHost leaves unlisted hosts alone', () => {
	assert.equal(
		isBlockedHost('https://site.test/style.css', ['captcha.example.com']),
		false
	);
});

test('isBlockedHost never matches URLs without a hostname', () => {
	const blocked = ['captcha.example.com'];
	assert.equal(isBlockedHost('blob:https://x.test/abc-123', blocked), false);
	assert.equal(isBlockedHost('data:text/plain,hi', blocked), false);
	assert.equal(isBlockedHost('not a url', blocked), false);
});

test('isBlockedHost is false for an empty or missing block list', () => {
	assert.equal(isBlockedHost('https://x.test/', []), false);
	assert.equal(isBlockedHost('https://x.test/', undefined), false);
});

test('groupViewportsByScaleFactor defaults a missing DPR to 1', () => {
	const groups = groupViewportsByScaleFactor([
		{ name: 'desktop', width: 1920, height: 1080 },
	]);
	assert.deepEqual(groups, [
		{
			deviceScaleFactor: 1,
			viewports: [{ name: 'desktop', width: 1920, height: 1080 }],
		},
	]);
});

test('groupViewportsByScaleFactor groups viewports that share a DPR', () => {
	const groups = groupViewportsByScaleFactor([
		{ name: 'desktop', width: 1920, height: 1080 },
		{ name: 'desktop-2x', width: 1920, height: 1080, deviceScaleFactor: 2 },
		{ name: 'mobile', width: 390, height: 844 },
		{ name: 'mobile-2x', width: 390, height: 844, deviceScaleFactor: 2 },
	]);
	// First-seen DPR order: 1 (default) then 2.
	assert.deepEqual(
		groups.map((g) => g.deviceScaleFactor),
		[1, 2]
	);
	assert.deepEqual(
		groups.map((g) => g.viewports.map((v) => v.name)),
		[
			['desktop', 'mobile'],
			['desktop-2x', 'mobile-2x'],
		]
	);
});
