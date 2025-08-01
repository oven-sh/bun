import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		files: {
			appTemplate: 'app/app.html',
			errorTemplate: 'app/error.html',
			lib: 'app/lib',
			routes: 'app/routes',
			hooks: {
				server: 'app/hooks.server.ts',
			},
		},
		adapter: adapter({
			reusePort: true,
		}),
		alias: {
			$assets: './app/assets',
			'~shared': './shared/',
		},
		csrf: false,
	},
};

export default config;
