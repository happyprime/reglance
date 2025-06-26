# Reglance

Visual regression at a glance.

## Installation

Install globally:

```bash
npm install -g reglance
```

Or use with npx:

```bash
npx reglance <command>
```

## Configuration

Reglance is configured via the `config.json` file in your project root. You can copy the example configuration to get started:

```bash
cp config.json.example config.json
```

Example configuration:

```json
{
	"defaults": {
		"viewports": [
			{
				"name": "desktop",
				"width": 1920,
				"height": 1080
			},
			{
				"name": "tablet",
				"width": 768,
				"height": 1024
			},
			{
				"name": "mobile",
				"width": 375,
				"height": 667
			}
		],
		"report_domain": "http://localhost:8080"
	},
	"example": {
		"urls": {
			"home": "https://example.com",
			"blog": "https://example.com/blog",
			"single-post": "https://example.com/blog/sample-post"
		}
	}
}
```

## Usage

### Capture Screenshots

Capture screenshots for all URLs in a property:

```bash
reglance capture <property>
# Example: reglance capture example
```

### Set Control Images

Move current captures to controls directory for baseline comparison:

```bash
reglance control <property> [url]
# Example: reglance control example
# Example: reglance control example home
```

### Compare Images

Compare latest captures with controls and generate reports:

```bash
reglance compare <slug|property>
# Example: reglance compare example
# Example: reglance compare example-home-desktop
```

## CLI Commands

- `reglance capture <property>` - Capture screenshots for all URLs in a property
- `reglance compare <slug|property>` - Compare captured images with controls  
- `reglance control <property> [url]` - Set current captures as controls

## Using as a Library

You can also import and use reglance functions directly:

```javascript
import { captureProperty, compareProperty, setControls, loadConfig } from 'reglance';

const config = loadConfig('./config.json');

// Capture screenshots
await captureProperty('example', config);

// Set controls
setControls('example', null, config);

// Compare and generate reports
await compareProperty('example', config);
```

## Directories

- `captures/` - Latest captured screenshots
- `controls/` - Baseline images for comparison  
- `compares/` - Generated diff images
- `reports/` - HTML comparison reports
