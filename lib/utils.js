import fs from 'fs';
import path from 'path';

/**
 * Load configuration from config.json
 * @param {string} configPath - Path to config file
 * @returns {object} Configuration object
 */
function loadConfig(configPath = './config.json') {
	if (!fs.existsSync(configPath)) {
		throw new Error(`Configuration file not found: ${configPath}`);
	}
	
	try {
		const configContent = fs.readFileSync(configPath, 'utf8');
		return JSON.parse(configContent);
	} catch (error) {
		throw new Error(`Failed to parse configuration file: ${error.message}`);
	}
}

/**
 * Ensure directory exists, create if it doesn't
 * @param {string} dir - Directory path
 */
function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * Create required directories for reglance
 * @param {Array<string>} dirs - Array of directory paths to create
 */
function ensureDirs(dirs = ['./captures', './controls', './reports', './compares']) {
	dirs.forEach(dir => ensureDir(dir));
}

export { loadConfig, ensureDir, ensureDirs };