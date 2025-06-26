#!/usr/bin/env node

import { captureProperty } from '../lib/capture.js';
import { compareSlug, compareProperty, isPropertyKey } from '../lib/compare.js';
import { setControls } from '../lib/control.js';
import { loadConfig, ensureDirs } from '../lib/utils.js';
import open from 'open';

// Parse command line arguments
function parseArgs() {
	const args = process.argv.slice(2);
	const command = args[0];
	const target = args[1];
	const additionalArg = args[2];

	return { command, target, additionalArg };
}

// Show usage information
function showUsage() {
	console.log('Usage: reglance <command> <target> [options]');
	console.log('');
	console.log('Commands:');
	console.log('  capture <property>    Capture screenshots for all URLs in a property');
	console.log('  compare <slug|property>  Compare captured images with controls');
	console.log('  control <property> [url]  Set current captures as controls');
	console.log('');
	console.log('Examples:');
	console.log('  reglance capture example');
	console.log('  reglance compare example-home-desktop');
	console.log('  reglance compare example');
	console.log('  reglance control example');
	console.log('  reglance control example home');
}

// Main execution function
async function main() {
	try {
		const { command, target, additionalArg } = parseArgs();

		// Show usage if no command provided
		if (!command || command === '--help' || command === '-h') {
			showUsage();
			process.exit(0);
		}

		// Validate command
		const validCommands = ['capture', 'compare', 'control'];
		if (!validCommands.includes(command)) {
			console.error(`Invalid command: ${command}`);
			showUsage();
			process.exit(1);
		}

		// Check if target is provided
		if (!target) {
			console.error(`Please provide a target for ${command} command.`);
			showUsage();
			process.exit(1);
		}

		// Load configuration
		const config = loadConfig();
		
		// Ensure required directories exist
		ensureDirs();

		// Execute command
		switch (command) {
			case 'capture':
				await handleCapture(target, config);
				break;
			case 'compare':
				await handleCompare(target, config);
				break;
			case 'control':
				await handleControl(target, additionalArg, config);
				break;
		}

	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

// Handle capture command
async function handleCapture(propertyKey, config) {
	console.log(`Capturing screenshots for property: ${propertyKey}`);
	await captureProperty(propertyKey, config);
	console.log(`Capture complete for ${propertyKey}`);
}

// Handle compare command
async function handleCompare(input, config) {
	if (isPropertyKey(input, config)) {
		console.log(`Comparing all URLs for property: ${input}`);
		await compareProperty(input, config);
	} else {
		console.log(`Comparing slug: ${input}`);
		const result = await compareSlug(input, config);
		if (result) {
			console.log(`\\nComparison complete for ${input}`);
			console.log(`Report generated at: ${result.reportUrl}`);
			console.log(`Diff image saved as: ${result.diffUrl}`);

			// Open the report in the default browser
			await open(result.reportUrl);
		}
	}
}

// Handle control command
async function handleControl(propertyKey, urlKey, config) {
	console.log(`Setting controls for property: ${propertyKey}${urlKey ? ` (URL: ${urlKey})` : ''}`);
	setControls(propertyKey, urlKey, config);
	console.log(`Control setting complete for ${propertyKey}${urlKey ? ` (URL: ${urlKey})` : ''}`);
}

// Run the main function
main().catch(console.error);