import { BunPlugin } from "bun";

globalThis.pluginLoaded = true;

export default {
  name: "long-bundler-plugin",
  setup(build) {
    build.onResolve({ filter: /frontend/ }, async args => {
      return { path: args.path, namespace: "frontend" };
    });
    build.onLoad({ filter: /frontend/, namespace: "frontend" }, async args => {
      await globalThis.callback();
      return { loader: "tsx", contents: "console.log('hello')" };
    });
  },
} satisfies BunPlugin;
