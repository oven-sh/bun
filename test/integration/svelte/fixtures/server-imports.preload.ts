import { SveltePlugin } from "bun-plugin-svelte";
Bun.plugin(SveltePlugin({ development: process.env.NODE_ENV === "development" }));
