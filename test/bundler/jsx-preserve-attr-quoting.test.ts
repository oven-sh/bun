import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler jsx preserve attribute quoting", () => {
  itBundled("jsx-preserve/AttrEqualsDoubleQuote", {
    files: {
      "/in.tsx": `export const el = <div title='"' />;`,
      "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // `esbuild` emits single-quoted (title='"') if it takes less escaping than double-quoted.
      if (!/title="\\\\""/.test(out) && !/title='"'/.test(out)) {
        throw new Error("Output did not contain expected quoting for title equal to a double quote.");
      }
    },
  });

  itBundled("jsx-preserve/AttrEqualsSingleQuote", {
    files: {
      "/in.tsx": `export const el = <div title="'" />;`,
      "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // Expect double-quoted attribute value containing a single quote, which should not need escaping.
      if (!/title="'"/.test(out) && !/title='''/.test(out)) {
        throw new Error("Output did not contain expected quoting for title equal to a single quote.");
      }
    },
  });

  itBundled("jsx-preserve/AttrEqualsBacktick", {
    files: {
      "/in.tsx": 'export const el = <div title="`" />;',
      "/tsconfig.json": `{"compilerOptions":{"jsx":"preserve","target":"ESNext"}}`,
    },
    outfile: "/out.js",
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      if (!/title="`"/.test(out) && !/title='`'/.test(out)) {
        throw new Error("Output did not contain expected quoting for title equal to a backtick.");
      }
    },
  });
});
