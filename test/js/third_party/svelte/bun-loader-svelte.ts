import { plugin } from "bun";

await plugin({
  name: "svelte loader",
  async setup(builder) {
    var { compile } = await import("svelte/compiler");
    var { readFileSync } = await import("fs");
    await 2;
    builder.onLoad({ filter: /\.svelte(\?[^.]+)?$/ }, ({ path }) => {
      const { js } = compile(
        readFileSync(path.substring(0, path.includes("?") ? path.indexOf("?") : path.length), "utf-8"),
        {
          filename: path,
          generate: "server",
          dev: false,
        },
      );
      return {
        contents: `${js.code}\n//# sourceMappingURL=${js.map.toUrl()}`,
        loader: "js",
      };
    });
    await 1;
  },
});
