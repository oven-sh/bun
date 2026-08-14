import { Database } from "bun:sqlite";
import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // https://github.com/oven-sh/bun/issues/18899
  itBundled("bun/import-bun-format-cjs", {
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import {RedisClient} from 'bun';
        import * as BunStar from 'bun';
        const bunRequire = require("bun");
        if (RedisClient.name !== "RedisClient") {
          throw new Error("RedisClient.name is not RedisClient");
        }
        if (BunStar.RedisClient.name !== "RedisClient") {
          throw new Error("BunStar.RedisClient.name is not RedisClient");
        }
        if (bunRequire.RedisClient.name !== "RedisClient") {
          throw new Error("bunRequire.RedisClient.name is not RedisClient");
        }

        console.log(RedisClient.name);
        console.log(BunStar.RedisClient.name);
        console.log(bunRequire.RedisClient.name);

        export class RedisCache {
          constructor(config: any) {
            this.connectServer(config);
          }
          
        }
      `,
    },
    run: { stdout: "RedisClient\nRedisClient\nRedisClient\n" },
  });
  // Regex literals and tagged template raw text are printed verbatim (UTF-8), so
  // the .jsc sidecar's SourceCodeKey has to be computed from the same decoding
  // the loader uses; otherwise JSC silently ignores the bytecode. (ESM bytecode
  // only exists with --compile; see bundler_compile.test.ts for both formats.)
  itBundled("bun/BytecodeSidecarNonAsciiRegexAndRawTemplate", {
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        const r = /café-中-🐰/u;
        const raw = String.raw\`é中🐰\`;
        console.log(JSON.stringify([r.source, r.source.length, raw, raw.length]));
      `,
    },
    run: {
      stdout: JSON.stringify(["café-中-🐰", "café-中-🐰".length, "é中🐰", "é中🐰".length]),
      env: {
        BUN_JSC_verboseDiskCache: "1",
      },
      validate({ stderr }) {
        expect(stderr).toContain("[Disk Cache] Cache hit for sourceCode");
      },
    },
  });
  itBundled("bun/embedded-sqlite-file", {
    target: "bun",
    outfile: "",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite", embed: "true"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!" },
  });
  itBundled("bun/sqlite-file", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
    },
    runtimeFiles: {
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!", setCwd: true },
  });
  itBundled("bun/TargetBunNoSourcemapMessage", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw new
            Error("Hello World");
        }
      `,
    },
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toInclude("\nnote: missing sourcemaps for ");
        expect(stderr).toInclude("\nnote: consider bundling with '--sourcemap' to get unminified traces\n");
      },
    },
  });
  itBundled("bun/TargetBunSourcemapInline", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw   new
            Error("Hello World");
        }
      `,
    },
    sourceMap: "inline",
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toStartWith(
          `1 | // this file has comments and weird whitespace, intentionally
2 | // to make it obvious if sourcemaps were generated and mapped properly
3 | if           (true) code();
4 | function code() {
5 |   // hello world
6 |           throw   new
                      ^
error: Hello World`,
        );
        expect(stderr).toInclude("entry.ts:6:19");
      },
    },
  });
  // The regex and raw template text make the bundle non-ASCII, so the runtime
  // holds it as a 16-bit string: the error preview is rendered from that
  // string and, with --sourcemap=inline, the sourceMappingURL comment is
  // located in it. Apart from the text itself, the output below is identical
  // to what the ASCII version of this file produces.
  const nonAsciiThrowFixture = /* js */ `
    // this file has comments and weird whitespace, intentionally
    // to make it obvious if sourcemaps were generated and mapped properly
    const marker = /café-中-🐰/u;
    if           (marker.test("café-中-🐰")) code();
    function code() {
      // hello world
      throw new class Boom extends Error {
        constructor() {
          super(String.raw\`Hello 🐰\`);
        }
      }();
    }
  `;
  itBundled("bun/TargetBunNoSourcemapNonAsciiPreview", {
    target: "bun",
    files: { "/entry.ts": nonAsciiThrowFixture },
    run: {
      exitCode: 1,
      validate({ stderr }) {
        // The regex text is shown as written while the string literal next to
        // it is still escaped. Context-line labels are not asserted: they are
        // off by one for bundled modules today, independently of this change.
        expect(stderr).toInclude("| var marker = /café-中-🐰/u;\n");
        expect(stderr).toInclude('| if (marker.test("caf\\xE9-\\u4E2D-\\uD83D\\uDC30"))\n');
        expect(stderr).toInclude(
          `7 |   throw new class Boom extends Error {
            ^
error: Hello 🐰
`,
        );
        expect(stderr).toMatch(/at code \(.*out\.js:7:9\)\n/);
        expect(stderr).toInclude("\nnote: missing sourcemaps for ");
      },
    },
  });
  itBundled("bun/TargetBunSourcemapInlineNonAscii", {
    target: "bun",
    files: { "/entry.ts": nonAsciiThrowFixture },
    sourceMap: "inline",
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toStartWith(
          `2 | // to make it obvious if sourcemaps were generated and mapped properly
3 | const marker = /café-中-🐰/u;
4 | if           (marker.test("café-中-🐰")) code();
5 | function code() {
6 |   // hello world
7 |   throw new class Boom extends Error {
            ^
error: Hello 🐰
`,
        );
        expect(stderr).toInclude("entry.ts:7:9");
        expect(stderr).toInclude("entry.ts:4:41");
        expect(stderr).not.toInclude("missing sourcemaps");
      },
    },
  });
  itBundled("bun/unicode comment", {
    target: "bun",
    files: {
      "/a.ts": /* js */ `
        /* æ */
      `,
    },
    run: { stdout: "" },
  });
  if (Bun.version.startsWith("1.4") || Bun.version.startsWith("1.3") || Bun.version.startsWith("1.2")) {
    for (const backend of ["api", "cli"] as const) {
      itBundled("bun/ExportsConditionsDevelopment" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('SUCCESS')`,
          "node_modules/pkg1/default.js": `console.log('FAIL')`,
        },
        backend,
        outfile: "out.js",
        define: { "process.env.NODE_ENV": '"development"' },
        run: {
          stdout: "SUCCESS",
        },
      });
      itBundled("bun/ExportsConditionsDevelopmentInProduction" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('FAIL')`,
          "node_modules/pkg1/default.js": `console.log('SUCCESS')`,
        },
        backend,
        outfile: "/Users/user/project/out.js",
        define: { "process.env.NODE_ENV": '"production"' },
        run: {
          stdout: "SUCCESS",
        },
      });
    }
  }
});
