# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reglance is a visual regression testing tool built with Node.js and Playwright. It captures full-page screenshots of websites across different viewports, compares them with baseline images (controls), and generates detailed HTML reports highlighting visual differences.

## Core Workflow Commands

### Capturing Screenshots
```bash
npm run capture <property>
```
- Uses Playwright to capture full-page screenshots
- Saves images to `captures/` directory
- Also saves HTML content to `captures/html/`
- Scrolls through entire page before capturing to ensure all content loads

### Setting Control Baselines
```bash
npm run control <property>
```
- Moves current captures from `captures/` to `controls/` directory
- These become the baseline images for future comparisons
- Both images and HTML files are moved

### Comparing Images
```bash
npm run compare <property>
```
- Compares latest captures with controls using pixelmatch
- Generates diff images showing pixel differences
- Creates comprehensive HTML reports with visual comparison sliders
- Opens comparison report in browser automatically
- Can also compare individual image slugs: `npm run compare <slug>`

### Code Quality
```bash
npm run lint    # Check code style with ESLint
npm run fix     # Auto-fix ESLint issues
```

## Configuration System

Properties are configured in `config.json` with the following structure:

```json
{
  "defaults": {
    "viewports": [...],
    "report_domain": "https://reglance.test"
  },
  "property-name": {
    "urls": {
      "page-name": "https://example.com/page"
    },
    "viewports": [...],  // Optional, uses defaults if not specified
    "pixelmatchOptions": {...}  // Optional comparison settings
  }
}
```

### Viewport Configuration
- Default viewports: desktop (1920x1080) and mobile (390x844)
- Properties can override with custom viewports (tablet, laptop, etc.)
- Each viewport generates separate screenshots and comparisons

### Pixelmatch Options
Properties can customize image comparison sensitivity:
- `threshold`: Matching threshold (0-1, lower = more sensitive)
- `includeAA`: Include anti-aliasing in comparison
- `alpha`: Alpha threshold for transparency
- `diffColor`: RGB color for highlighting differences

## Architecture

### Core Scripts
- `capture.mjs`: Playwright-based screenshot capture with auto-scrolling
- `compare.mjs`: Image comparison using pixelmatch, HTML diff generation
- `control.mjs`: Baseline management (moving captures to controls)

### File Naming Convention
Files follow pattern: `{property}-{urlKey}-{viewport}.png`
Example: `pinchofyum-home-desktop.png`

### Directory Structure
- `captures/`: Latest screenshots and HTML snapshots
- `controls/`: Baseline images and HTML for comparison
- `compares/`: Generated diff images and HTML diff reports
- `reports/`: Comprehensive comparison reports with interactive viewers
- `assets/`: JavaScript and CSS for report interfaces

### Report Generation
- Individual comparison reports for each image pair
- Property-level index pages with sortable results tables
- Interactive diff viewer with modal overlay and keyboard navigation
- HTML diff reports showing markup changes line-by-line
- Visual comparison sliders for before/after image inspection

## Development Notes

- Uses @happyprime/eslint-config for consistent code style
- Tab indentation for JavaScript, space indentation for YAML
- Playwright runs with certificate error ignoring for local development
- Network idle timeout of 10 seconds with fallback screenshot capture
- Images are automatically padded to match heights for comparison
- Reports include pixelmatch configuration details for transparency