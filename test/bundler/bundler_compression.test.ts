import { describe } from "bun:test";
import { itBundled } from "./expectBundled";
import * as zlib from "zlib";

describe("bundler", () => {
  itBundled("compression/gz-gzip-basic", {
    files: {
      "/entry.ts": /* ts */ `
        import { utils } from "./utils";
        console.log(utils.greet("World"));
        export const version = "1.0.0";
      `,
      "/utils.ts": /* ts */ `
        export const utils = {
          greet: (name: string) => \`Hello, \${name}!\`
        };
      `,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    gz: "gzip",
    onAfterBundle(api) {
      // Build should succeed with one output file
      api.expectBundled({
        "/out/entry.js.gz": {
          isGzipped: true,
          contains: ["Hello, ", "World", "1.0.0"],
        },
      });
    },
  });

  itBundled("compression/gz-gzip-multiple-entry-points", {
    files: {
      "/entry1.ts": /* ts */ `
        export const message = "Entry 1";
        console.log(message);
      `,
      "/entry2.ts": /* ts */ `
        export const message = "Entry 2";  
        console.log(message);
      `,
    },
    entryPoints: ["/entry1.ts", "/entry2.ts"],
    outdir: "/out",
    gz: "gzip",
    onAfterBundle(api) {
      api.expectBundled({
        "/out/entry1.js.gz": {
          isGzipped: true,
          contains: ["Entry 1"],
        },
        "/out/entry2.js.gz": {
          isGzipped: true,
          contains: ["Entry 2"],
        },
      });
    },
  });

  itBundled("compression/gz-gzip-no-css-compression", {
    files: {
      "/entry.ts": /* ts */ `
        import "./styles.css";
        console.log("Hello CSS");
      `,
      "/styles.css": /* css */ `
        body { color: red; }
        h1 { font-size: 24px; }
      `,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    gz: "gzip",
    onAfterBundle(api) {
      api.expectBundled({
        "/out/entry.js.gz": {
          isGzipped: true,
          contains: ["Hello CSS"],
        },
        "/out/entry.css": {
          isFile: true,
          isGzipped: false,
        },
      });
    },
  });

  itBundled("compression/gz-gzip-no-asset-compression", {
    files: {
      "/entry.ts": /* ts */ `
        import logo from "./logo.png";
        console.log(logo);
      `,
      "/logo.png": new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG header
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
      ]),
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    loader: { ".png": "file" },
    gz: "gzip",
    onAfterBundle(api) {
      api.expectBundled({
        "/out/entry.js.gz": {
          isGzipped: true,
        },
        "/out/logo.png": {
          isFile: true,
          isGzipped: false,
        },
      });
    },
  });

  itBundled("compression/gz-gzip-code-splitting", {
    files: {
      "/entry1.ts": /* ts */ `
        import { shared } from "./shared";
        console.log("Entry 1:", shared());
      `,
      "/entry2.ts": /* ts */ `
        import { shared } from "./shared";
        console.log("Entry 2:", shared());
      `,
      "/shared.ts": /* ts */ `
        export function shared() {
          return "Shared code";
        }
      `,
    },
    entryPoints: ["/entry1.ts", "/entry2.ts"],
    outdir: "/out",
    splitting: true,
    gz: "gzip",
    onAfterBundle(api) {
      // All JavaScript chunks should be compressed
      const files = api.readDir("/out");
      for (const file of files) {
        if (file.endsWith(".js.gz")) {
          api.expectBundled({
            [`/out/${file}`]: {
              isGzipped: true,
            },
          });
        }
      }
    },
  });

  itBundled("compression/gz-gzip-sourcemap-external", {
    files: {
      "/entry.ts": /* ts */ `
        const x: number = 42;
        console.log(x);
      `,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    sourceMap: "external",
    gz: "gzip",
    onAfterBundle(api) {
      api.expectBundled({
        "/out/entry.js.gz": {
          isGzipped: true,
          contains: ["//# sourceMappingURL=entry.js.map"],
        },
        "/out/entry.js.map": {
          isFile: true,
          isGzipped: false,
        },
      });
    },
  });

  itBundled("compression/gz-invalid-value", {
    files: {
      "/entry.ts": `console.log("test");`,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    gz: "invalid",
    bundleErrors: {
      "/entry.ts": ["Invalid compression type"],
    },
  });

  itBundled("compression/gz-with-compile-error", {
    files: {
      "/entry.ts": `console.log("test");`,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    compile: true,
    gz: "gzip",
    bundleErrors: {
      "/entry.ts": ["--gz cannot be used with --compile"],
    },
  });

  itBundled("compression/gz-brotli-not-implemented", {
    files: {
      "/entry.ts": `console.log("test");`,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    gz: "brotli",
    bundleErrors: {
      "/entry.ts": ["Brotli compression is not yet implemented"],
    },
  });

  itBundled("compression/gz-gzip-with-minification", {
    files: {
      "/entry.ts": /* ts */ `
        function longFunctionNameThatShouldBeMinified() {
          const longVariableNameThatShouldBeMinified = "Hello World";
          return longVariableNameThatShouldBeMinified;
        }
        console.log(longFunctionNameThatShouldBeMinified());
      `,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    minify: true,
    gz: "gzip",
    onAfterBundle(api) {
      api.expectBundled({
        "/out/entry.js.gz": {
          isGzipped: true,
          contains: ["Hello World"],
          doesNotContain: ["longFunctionNameThatShouldBeMinified", "longVariableNameThatShouldBeMinified"],
        },
      });
    },
  });

  itBundled("compression/gz-gzip-with-target-node", {
    files: {
      "/entry.ts": /* ts */ `
        const asyncFn = async () => {
          const module = await import("./dynamic");
          return module.default;
        };
        asyncFn();
      `,
      "/dynamic.ts": /* ts */ `
        export default "Dynamic import";
      `,
    },
    entryPoints: ["/entry.ts"],
    outdir: "/out",
    target: "node",
    gz: "gzip",
    onAfterBundle(api) {
      // All JS outputs should be compressed
      const files = api.readDir("/out");
      for (const file of files) {
        if (file.endsWith(".js")) {
          throw new Error(`Found uncompressed JS file: ${file}`);
        }
        if (file.endsWith(".js.gz")) {
          api.expectBundled({
            [`/out/${file}`]: {
              isGzipped: true,
            },
          });
        }
      }
    },
  });
});
