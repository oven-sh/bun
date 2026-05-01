import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      reusePort: true,
    }),
    alias: {
      $assets: "./src/assets",
      "~shared": "./shared/",
    },
    csrf: {
      trustedOrigins: [],
    },
  },
};

export default config;
