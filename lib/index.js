// Main entry point for the reglance library
export { captureProperty, captureFullPageScreenshot, generateFileName } from './capture.js';
export { 
	compareSlug, 
	compareProperty, 
	isPropertyKey, 
	getViewports,
	compareHTML,
	generateHTMLDiffReport,
	defaultPixelmatchOptions 
} from './compare.js';
export { setControls, processUrl, findLatestCapture, copyToControls } from './control.js';
export { loadConfig, ensureDir, ensureDirs } from './utils.js';