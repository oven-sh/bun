import { plugin } from "bun";
import { compile } from "svelte/compiler";

plugin({
  name: "svelte loader with a source map",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const { js } = compile(await Bun.file(path).text(), { filename: path, generate: "server", dev: false });
      return {
        contents: `${js.code}\n//# sourceMappingURL=${js.map.toUrl()}`,
        loader: "js",
      };
    });
  },
});
