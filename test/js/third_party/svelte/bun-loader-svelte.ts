import { plugin } from "bun";

await plugin({
  name: "svelte loader",
  async setup(builder) {
    var { compile } = await import("svelte/compiler");
    var { readFileSync } = await import("fs");
    await 2;
    builder.onLoad({ filter: /\.svelte(\?[^.]+)?$/ }, ({ path }) => ({
      contents: compile(
        readFileSync(path.substring(0, path.includes("?") ? path.indexOf("?") : path.length), "utf-8"),
        {
          filename: path,
          generate: "ssr",
        },
      ).js.code,
      loader: "js",
    }));
    await 1;
  },
});
