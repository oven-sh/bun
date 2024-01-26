import { plugin } from "bun";

await plugin({
  name: "svelte loader",
  async setup(builder) {
    var { compile } = await import("svelte/compiler");
    var { readFileSync } = await import("fs");
    await 2;
    console.log(1);
    builder.onLoad({ filter: /\.svelte$/ }, ({ path }) => {
      console.log(2);
      return {
        contents: compile(readFileSync(path, "utf8"), {
          filename: path,
          generate: "ssr",
        }).js.code,
        loader: "js",
      };
    });
    await 1;
  },
});

console.log(require("./hello.svelte"));
