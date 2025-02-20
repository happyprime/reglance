import { chromium } from 'playwright';

async function captureFullPageScreenshot(url, outputPath, viewportWidth = 1920, viewportHeight = 1080) {
  const browser = await chromium.launch({
    args: ['--ignore-certificate-errors'],
    ignoreHTTPSErrors: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.setViewportSize({
      width: viewportWidth,
      height: viewportHeight
    });

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Scroll to bottom and back up
    await autoScroll(page);

    // Wait a bit for any final loading
    await page.waitForTimeout(2000);

    // Capture full page screenshot
    await page.screenshot({
      path: outputPath,
      fullPage: true
    });

    console.log(`Full screenshot saved to ${outputPath}`);

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    await browser.close();
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

// Get command line arguments
const [,, url, outputPath, viewportWidth, viewportHeight] = process.argv;

// Check if both URL and output path are provided
if (!url || !outputPath) {
  console.error('Please provide both a URL and an output path.');
  console.error('Usage: node screenshot.js <url> <output_path> [viewport_width] [viewport_height]');
  process.exit(1);
}

// Run the screenshot function
captureFullPageScreenshot(url, outputPath, parseInt(viewportWidth) || 1920, parseInt(viewportHeight) || 1080);
