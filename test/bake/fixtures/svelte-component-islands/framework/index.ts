import type { Bake } from "bun";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as svelte from "svelte/compiler";

export default function (): Bake.Framework {
  return {
    serverComponents: {
      separateSSRGraph: false,
      serverRuntimeImportSource: "./framework/server.ts",
    },
    fileSystemRouterTypes: [
      {
        root: "pages",
        serverEntryPoint: "./framework/server.ts",
        clientEntryPoint: "./framework/client.ts",
        style: "nextjs-pages", // later, this will be fully programmable
        extensions: [".svelte"],
      },
    ],
    plugins: [
      {
        // This is missing a lot of code that a plugin like `esbuild-svelte`
        // handles, but this is only an examplea of how such a plugin could
        // have server-components at a minimal level.
        name: "svelte-server-components",
        setup(b) {
          const cssMap = new Map<string, string>();
          b.onLoad({ filter: /.svelte$/ }, async (args) => {
            const contents = await fs.readFile(args.path, "utf-8");
            const result = svelte.compile(contents, {
              filename: args.path,
              css: "external",
              cssOutputFilename: path.basename(args.path, ".svelte") + ".css",
              hmr: true,
              dev: true,
              generate: args.side,
            });
            // If CSS is specified, add a CSS import
            let jsCode = result.js.code;
            if (result.css) {
              cssMap.set(args.path, result.css.code);
              jsCode = `import ${JSON.stringify("svelte-css:" + args.path)};` + jsCode;
            }
            // Extract a "use client" directive from the file.
            const header = contents.match(/^\s*<script.*?>\s*("[^"\n]*"|'[^'\n]*')/)?.[1];
            if (header) {
              jsCode = header + ';' + jsCode;
            }
            return {
              contents: jsCode,
              loader: "js",
              watchFiles: [args.path],
            };
          });

          // Resolve CSS files
          b.onResolve({ filter: /^svelte-css:/ }, async (args) => {
            return { path: args.path.replace(/^svelte-css:/, ""), namespace: "svelte-css" };
          });
          b.onLoad({ filter: /./, namespace: "svelte-css" }, async (args) => {
            return { contents: cssMap.get(args.path) ?? "", loader: "css" };
          });
        },
      },
    ],
  };
}
