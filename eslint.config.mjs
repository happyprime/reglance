import config from '@happyprime/eslint-config';

export default [
	...config,
	{
		// reglance is a CLI: console.log/warn ARE its user-facing output, so
		// only the noisier debugging methods (debug, info, table, …) stay
		// flagged. Templates ship to the browser and keep the shared rule.
		files: ['bin/**/*.mjs', 'src/**/*.mjs'],
		rules: {
			'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
		},
	},
	{
		// Project style: no hyphen between a JSDoc param name and its
		// description, with types, names, and descriptions aligned in columns.
		rules: {
			'jsdoc/require-hyphen-before-param-description': ['warn', 'never'],
			// Align params with each other only — a long @returns type would
			// otherwise drag every description far to the right.
			'jsdoc/check-line-alignment': [
				'warn',
				'always',
				{ tags: ['param', 'property'] },
			],
		},
	},
];
