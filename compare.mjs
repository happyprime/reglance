import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import path from 'path';
import crypto from 'crypto';

// Get command line arguments
const [, , image1, image2] = process.argv;

// Check if both image paths are provided
if (!image1 || !image2) {
	console.error('Please provide paths to two images.');
	console.error('Usage: node compare.js <path_to_image1> <path_to_image2>');
	process.exit(1);
}

// Check if files exist
if (!fs.existsSync(image1) || !fs.existsSync(image2)) {
	console.error('One or both of the specified image files do not exist.');
	process.exit(1);
}

let img1 = PNG.sync.read(fs.readFileSync(image1));
let img2 = PNG.sync.read(fs.readFileSync(image2));

// Ensure both images have the same width
if (img1.width !== img2.width) {
	console.error('Images must have the same width.');
	process.exit(1);
}

// Function to pad an image to a specific height
/**
 *
 * @param img
 * @param targetHeight
 */
function padImage(img, targetHeight) {
	const paddedImg = new PNG({ width: img.width, height: targetHeight });
	PNG.bitblt(img, paddedImg, 0, 0, img.width, img.height, 0, 0);
	return paddedImg;
}

// Create reports and compares directories if they don't exist
const reportsDir = 'reports';
const comparesDir = 'compares';
if (!fs.existsSync(reportsDir)) {
	fs.mkdirSync(reportsDir);
}
if (!fs.existsSync(comparesDir)) {
	fs.mkdirSync(comparesDir);
}

/**
 *
 * @param originalPath
 * @param secondPath
 * @param diffPath
 */
async function generateReport(originalPath, secondPath, diffPath) {
	// Read the template
	let template = fs.readFileSync('report.html', 'utf8');

	// Generate timestamp for filename
	const now = new Date();
	const timestamp = now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace('T', '-')
		.replace(/\..+/, '');

	// Calculate relative paths from report location to images
	const relativeOriginal = path.relative(reportsDir, originalPath);
	const relativeSecond = path.relative(reportsDir, secondPath);
	const relativeDiff = path.relative(reportsDir, diffPath);

	// Update image sources in the template
	template = template.replace('{originalImage}', relativeOriginal);
	template = template.replace('{secondImage}', relativeSecond);

	// Add diff image path for the toggle functionality
	template = template.replace('{diffImage}', relativeDiff);

	// Save the report
	const reportPath = path.join(reportsDir, `${timestamp}-compare.html`);
	fs.writeFileSync(reportPath, template);

	return reportPath;
}

/**
 *
 * @param filepath
 */
function getBasename(filepath) {
	return filepath
		.split('/')
		.pop()
		.replace(/\.[^/.]+$/, '');
}

/**
 *
 * @param str
 */
async function sha256(str) {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 *
 */
async function main() {
	// Determine the maximum height
	const maxHeight = Math.max(img1.height, img2.height);

	// Pad images if necessary
	if (img1.height < maxHeight) {
		img1 = padImage(img1, maxHeight);
	}
	if (img2.height < maxHeight) {
		img2 = padImage(img2, maxHeight);
	}

	const diff = new PNG({ width: img1.width, height: maxHeight });

	pixelmatch(img1.data, img2.data, diff.data, img1.width, maxHeight, {
		threshold: 0.1,
	});

	const img1Base = getBasename(image1);
	const img2Base = getBasename(image2);
	const combinedHash = await sha256(img1Base + img2Base);

	// Generate diff filename using timestamp to ensure uniqueness
	const diffPath = path.join(comparesDir, `${combinedHash}-diff.png`);

	// Save the diff image
	fs.writeFileSync(diffPath, PNG.sync.write(diff));

	// Generate and save the report
	const reportPath = await generateReport(image1, image2, diffPath);

	console.log(`Comparison complete. Diff image saved as '${diffPath}'.`);
	console.log(`Report generated at: ${reportPath}`);
	console.log(`Images processed at ${img1.width}x${maxHeight} resolution.`);
}

// Call the main function
main().catch(console.error);
