# Reglance

Visual regression at a glance.

## Installation

```bash
npm install
```

## Configuration

Reglance is configured via the `config.json` file.

```json
{
	"defaults": {
		"viewports": [
			{
				"name": "desktop",
				"width": 1920,
				"height": 1080
			}
		]
	},
	"example": {
		"urls": {
			"home": "https://example.test",
			"blog": "https://example.test/blog",
			"single-post": "https://example.test/blog/single-post"
		}
	}
}
```

## Usage

```bash
npm run capture <property>
```

Capture will visit each of the URLs and viewports attached to a property and save full page screenshots
to the `captures` directory.

```bash
npm run control <property>
```

Control will move all of the current captures into the `controls` directory to be used as a baseline for
comparison with future captures.

```bash
npm run compare <property>
```

Compare will compare the latest captures from a property, compare them with the property's controls, and
generate reports in the `reports` directory.

## Directories

- `captures`: The latest captures for a property
- `controls`: The control captures used for comparison.
- `compares`: The latest comparisons.
- `reports`: The latest reports.
