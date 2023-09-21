import { plugin } from "bun";

plugin({
  name: "svelte loader",
  async setup(builder) {
    var { compile } = await import("svelte/compiler");
    var { readFileSync } = await import("fs");
    await 2;
    builder.onLoad({ filter: /\.svelte$/ }, ({ path }) => ({
      contents: compile(readFileSync(path, "utf8"), {
        filename: path,
        generate: "ssr",
      }).js.code,
      loader: "js",
    }));
    await 1;
  },
});
