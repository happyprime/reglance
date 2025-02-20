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

fs.writeFileSync('diff.png', PNG.sync.write(diff));

console.log(`Comparison complete. Diff image saved as 'diff.png'.`);
console.log(`Images processed at ${img1.width}x${maxHeight} resolution.`);

/*
resemble(image1)
  .compareTo(image2)
  .onComplete(data => {

	console.log( data );
    console.log('Mismatch percentage:', data.misMatchPercentage);

    const diffImage = data.getBuffer();

    fs.writeFileSync('diff.png', diffImage);

    const htmlReport = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Image Comparison Report</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
        h1 { color: #333; }
        .image-container { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .image-container img { max-width: 30%; height: auto; }
        .stats { background: #f4f4f4; padding: 10px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>Image Comparison Report</h1>
      <div class="image-container">
        <img src="${path.basename(image1)}" alt="Original Image">
        <img src="${path.basename(image2)}" alt="New Image">
        <img src="diff.png" alt="Diff Image">
      </div>
      <div class="stats">
        <p>Mismatch Percentage: ${data.misMatchPercentage}%</p>
        <p>Analysis Time: ${data.analysisTime} ms</p>
      </div>
    </body>
    </html>
    `;

    fs.writeFileSync('report.html', htmlReport);
    console.log('Comparison complete. Open report.html to view results.');
  });
*/
