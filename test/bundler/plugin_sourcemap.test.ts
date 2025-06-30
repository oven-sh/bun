import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

function makePlugin() {
  return function (builder: any) {
    builder.onLoad({ filter: /\.foo$/ }, async (args: any) => {
      const text = await Bun.file(args.path).text();
      const js = `export const msg = ${JSON.stringify(text)};`;

      // Very small identity sourcemap (each line maps to the same line/column in the original file)
      const lineCount = js.split("\n").length;
      const mappings = new Array(lineCount).fill("AAAA").join(";");
      const sourcemap = JSON.stringify({
        version: 3,
        sources: [args.path],
        names: [],
        mappings,
        sourcesContent: [text],
      });

      return {
        contents: js,
        loader: "js",
        sourcemap,
      };
    });
  };
}

describe("bundler – plugin sourcemap", () => {
  itBundled("plugin/SourcemapBasic", {
    files: {
      "index.ts": /* ts */ `
        import { msg } from "./hello.foo";
        console.log(msg);
      `,
      "hello.foo": `Hello, World!`,
    },
    plugins: makePlugin(),
    sourceMap: "external",
    run: {
      stdout: "Hello, World!",
    },
  });

  // Error reporting should point back to original .foo line
  itBundled("plugin/SourcemapErrorLine", {
    files: {
      "index.ts": /* ts */ `import './boom.foo'`,
      "boom.foo": `
        // line 1 (comment)
        throw new Error('bad things'); // line 2
      `,
    },
    plugins: makePlugin(),
    sourceMap: "external",
    run: {
      error: "Error: bad things",
      errorLineMatch: /throw new Error\('bad things'\)/,
    },
  });

  // Ensure minified builds still respect plugin sourcemaps
  itBundled("plugin/SourcemapMinified", {
    files: {
      "index.ts": `import { msg } from './msg.foo'; console.log(msg);`,
      "msg.foo": `minified!`,
    },
    plugins: makePlugin(),
    sourceMap: "external",
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    run: {
      stdout: "minified!",
    },
  });
});