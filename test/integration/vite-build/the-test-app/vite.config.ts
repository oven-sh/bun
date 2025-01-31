import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

// const hexLoader: Plugin = {
// 	name: 'hex-loader',
// 	async transform(_code, id: string) {
// 		const [path, query] = id.split('?');
// 		if (query != 'raw-hex') return null;

// 		const data = await Bun.file(path).bytes();
// 		const hex = data.toHex();

// 		return `export default '${hex}';`;
// 	},
// };

export default defineConfig({
	server: { fs: { allow: ['app', 'shared/utils.ts'] } },
	plugins: [sveltekit()],
	define: { PKG: pkg },
});
