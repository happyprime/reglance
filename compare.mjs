import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

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

// Add these functions after the imports
function getBasename(filepath) {
	return filepath.split('/').pop().replace(/\.[^/.]+$/, '');
}

async function sha256(str) {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Make the main code async
async function main() {
	// Create compares directory if it doesn't exist
	if (!fs.existsSync('compares')) {
		fs.mkdirSync('compares');
	}

	// Generate the diff filename
	const img1Base = getBasename(image1);
	const img2Base = getBasename(image2);
	const combinedHash = await sha256(img1Base + img2Base);
	const diffPath = `compares/${combinedHash}.png`;

	fs.writeFileSync(diffPath, PNG.sync.write(diff));

	console.log(`Comparison complete. Diff image saved as '${diffPath}'.`);
	console.log(`Images processed at ${img1.width}x${maxHeight} resolution.`);
	console.log(`View comparison at: report.html?original=${img1Base}&second=${img2Base}`);
}

// Call the main function
main().catch(console.error);
