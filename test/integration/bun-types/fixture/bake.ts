import { defineConfig, type Config } from "bun:bake";
const plugin = { name: "x", setup() {} };
const a = defineConfig({ plugins: [plugin] });
const b = defineConfig(({ mode }) => ({ plugins: mode === "development" ? [plugin] : [] }));
const c: Config = a;
// @ts-expect-error: an option bun bake does not use
defineConfig({ plugin: [] });
export { b, c };
