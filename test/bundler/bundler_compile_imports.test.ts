import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { BundlerTestInput, itBundled as itBundledBase } from "./expectBundled";

// Default to the CLI backend. We intentionally use plain `describe` here
// (not `describe.concurrent`): since the ELF-section inject path was added,
// each `bun build --compile` on Linux reads + rewrites the full executable
// (~500MB for profile builds). Running 20 of these concurrently exhausts CI
// memory/IO and causes subprocess timeouts — see build #40193 failures.
const itBundled = (id: string, opts: BundlerTestInput) => itBundledBase(id, { backend: "cli", ...opts });

describe("bundler", () => {
  itBundled("compile/DynamicRequire", {
    files: {
      "/entry.tsx": /* tsx */ `
        const req = (x) => require(x);
        const y = req('commonjs');
        const z = req('esm').default;
        console.log(JSON.stringify([w, x, y, z]));
        module.exports = null;
      `,
      "/node_modules/commonjs/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/esm/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other-esm/index.js": "throw new Error('Must be runtime import.')",
    },
    runtimeFiles: {
      "/node_modules/commonjs/index.js": "module.exports = 2; require('other');",
      "/node_modules/esm/index.js": "import 'other-esm'; export default 3;",
      "/node_modules/other/index.js": "globalThis.x = 1;",
      "/node_modules/other-esm/index.js": "globalThis.w = 0;",
    },
    run: {
      stdout: "[0,1,2,3]",
      setCwd: true,
    },
    compile: true,
  });
  itBundled("compile/DynamicImport", {
    files: {
      "/entry.tsx": /* tsx */ `
        import 'static';
        const imp = (x) => import(x).then(x => x.default);
        const y = await imp('commonjs');
        const z = await imp('esm');
        console.log(JSON.stringify([w, x, y, z]));
      `,
      "/node_modules/static/index.js": "'use strict';",
      "/node_modules/commonjs/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/esm/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other-esm/index.js": "throw new Error('Must be runtime import.')",
    },
    runtimeFiles: {
      "/node_modules/commonjs/index.js": "module.exports = 2; require('other');",
      "/node_modules/esm/index.js": "import 'other-esm'; export default 3;",
      "/node_modules/other/index.js": "globalThis.x = 1;",
      "/node_modules/other-esm/index.js": "globalThis.w = 0;",
    },
    run: {
      stdout: "[0,1,2,3]",
      setCwd: true,
    },
    compile: true,
  });
  // see comment in `usePackageManager` for why this is a test
  itBundled("compile/NoAutoInstall", {
    files: {
      "/entry.tsx": /* tsx */ `
        const req = (x) => require(x);
        console.log(req('express'));
      `,
    },
    run: {
      error: 'Cannot find package "express"',
      setCwd: true,
    },
    compile: true,
  });
  itBundled("compile/CanRequireLocalPackages", {
    files: {
      "/entry.tsx": /* tsx */ `
        const req = (x) => require(x);
        console.log(req('react/package.json').version);
      `,
    },
    run: {
      stdout: require("react/package.json").version,
      setCwd: false,
    },
    compile: true,
  });
  for (const minify of [true, false] as const) {
    itBundled("compile/platform-specific-binary" + (minify ? "-minify" : ""), {
      minifySyntax: minify,
      target: "bun",
      compile: true,
      files: {
        "/entry.ts": /* js */ `
        await import(\`./platform.\${process.platform}.\${process.arch}.js\`);
    `,
        [`/platform.${process.platform}.${process.arch}.js`]: `console.log("${process.platform}", "${process.arch}");`,
      },
      run: { stdout: `${process.platform} ${process.arch}` },
    });
    for (const sourceMap of ["external", "inline", "none"] as const) {
      // https://github.com/oven-sh/bun/issues/10344
      itBundled("compile/10344+sourcemap=" + sourceMap + (minify ? "+minify" : ""), {
        minifyIdentifiers: minify,
        minifySyntax: minify,
        minifyWhitespace: minify,
        target: "bun",
        sourceMap,
        compile: true,
        files: {
          "/entry.ts": /* js */ `
        import big from './generated.big.binary' with {type: "file"};
        import small from './generated.small.binary' with {type: "file"};
        import fs from 'fs';
        fs.readFileSync(big).toString("hex");
        await Bun.file(big).arrayBuffer();
        fs.readFileSync(small).toString("hex");
        if ((await fs.promises.readFile(small)).length !== 31) throw "fail readFile";
        if (fs.statSync(small).size !== 31) throw "fail statSync";
        if (fs.statSync(big).size !== (4096 + (32 - 2))) throw "fail statSync";
        if (((await fs.promises.stat(big)).size) !== (4096 + (32 - 2))) throw "fail stat";
        await Bun.file(small).arrayBuffer();
        console.log("PASS");
      `,
          "/generated.big.binary": (() => {
            // make sure the size is not divisible by 32
            const buffer = new Uint8ClampedArray(4096 + (32 - 2));
            for (let i = 0; i < buffer.length; i++) {
              buffer[i] = i;
            }
            return buffer;
          })(),
          "/generated.small.binary": (() => {
            // make sure the size is less than 32
            const buffer = new Uint8ClampedArray(31);
            for (let i = 0; i < buffer.length; i++) {
              buffer[i] = i;
            }
            return buffer;
          })(),
        },
        run: { stdout: "PASS" },
      });
    }
  }
  itBundled("compile/EmbeddedSqlite", {
    compile: true,
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
  itBundled("compile/sqlite-file", {
    compile: true,
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

  // A text import in a compiled executable is embedded as a string body
  // (8-bit when ASCII, UTF-16LE otherwise) that the runtime hands back without
  // a parse or a copy, instead of a JS module with a string literal. The same source also checks `require()`, `import()`, and that
  // `Bun.embeddedFiles` keeps listing only real assets.
  // Buffers: `files` strings go through dedent(), which would trim them.
  const textImportFiles = {
    "/ascii.txt": Buffer.from("hello world\nline 2\n"),
    "/latin1.txt": Buffer.from("caf\u00e9 na\u00efve\n"),
    "/wide.txt": Buffer.from("em \u2014 dash \u{1F600} emoji \u65e5\u672c\n"),
    "/empty.txt": Buffer.alloc(0),
    "/invalid.txt": Buffer.from([0x62, 0x61, 0x64, 0x20, 0xff, 0xfe, 0x20, 0xc3, 0x28, 0x0a]),
    "/doc.md": Buffer.from("# Title\n\nsome *markdown* \u2014 with dash\n"),
    "/asset.file": "abcd",
  };
  const textImportEntry = /* js */ `
    import ascii from "./ascii.txt";
    import latin1 from "./latin1.txt";
    import wide from "./wide.txt";
    import empty from "./empty.txt";
    import invalid from "./invalid.txt";
    import doc from "./doc.md";
    import asset from "./asset.file" with { type: "file" };
    import { readdirSync, readFileSync } from "node:fs";
    import { dirname, join } from "node:path";

    // No top-level await: the bytecode variant is CommonJS output.
    async function main() {
      // The embedded root. \`import.meta.dir\` is inlined at build time in CommonJS output.
      const root = dirname(Bun.main);
      const expected = {
        ascii: "hello world\\nline 2\\n",
        latin1: "caf\\u00e9 na\\u00efve\\n",
        wide: "em \\u2014 dash \\u{1F600} emoji \\u65e5\\u672c\\n",
        empty: "",
        // Invalid UTF-8 decodes like TextDecoder: one U+FFFD per bad byte.
        invalid: "bad \\ufffd\\ufffd \\ufffd(\\n",
        doc: "# Title\\n\\nsome *markdown* \\u2014 with dash\\n",
      };
      const actual = { ascii, latin1, wide, empty, invalid, doc };
      for (const [name, value] of Object.entries(actual)) {
        if (typeof value !== "string") throw new Error(name + " is a " + typeof value);
        if (value !== expected[name]) throw new Error(name + " mismatch: " + JSON.stringify(value));
      }
      if (require("./ascii.txt") !== ascii) throw new Error("require() returned " + JSON.stringify(require("./ascii.txt")));
      if ((await import("./wide.txt")).default !== wide) throw new Error("import() mismatch");

      // Text modules are not assets; only the file loader import is listed.
      const embedded = Bun.embeddedFiles.map(blob => blob.name);
      if (embedded.length !== 1 || !embedded[0].startsWith("asset-")) throw new Error("embeddedFiles: " + embedded);
      if ((await Bun.file(asset).text()) !== "abcd") throw new Error("asset: " + asset);

      // Reading the embedded module as a file gives its text as UTF-8, whichever width the body is stored in.
      const encoded = {
        "ascii.txt": Buffer.from(expected.ascii),
        "latin1.txt": Buffer.from(expected.latin1),
        "wide.txt": Buffer.from(expected.wide),
        "empty.txt": Buffer.alloc(0),
        "invalid.txt": Buffer.from(expected.invalid),
        "doc.md": Buffer.from(expected.doc),
      };
      const embeddedNames = readdirSync(root);
      for (const [name, bytes] of Object.entries(encoded)) {
        const [base, ext] = name.split(".");
        const file = embeddedNames.find(entry => entry.startsWith(base + "-") && entry.endsWith("." + ext));
        if (!file) throw new Error("no embedded module for " + name + " in " + JSON.stringify(embeddedNames));
        const got = readFileSync(join(root, file));
        if (!got.equals(bytes)) throw new Error(name + ": " + got.toString("hex") + " != " + bytes.toString("hex"));
      }
      console.log("PASS");
    }
    main();
  `;
  for (const [suffix, options] of [
    ["", {}],
    ["Bytecode", { bytecode: true }],
    ["BytecodeESM", { bytecode: true, format: "esm" }],
  ] as const) {
    itBundled(`compile/TextImport${suffix}`, {
      compile: true,
      ...options,
      loader: { ".md": "text" },
      files: { "/entry.ts": textImportEntry, ...textImportFiles },
      run: { stdout: "PASS" },
    });
  }

  // Text modules keep their own `[name]-[hash]` path: a user `--asset-naming`
  // without `[hash]` must not make two same-named text files share one path.
  itBundled("compile/TextImportSameBasename", {
    compile: true,
    assetNaming: "[name].[ext]",
    files: {
      "/entry.ts": /* js */ `
        import a from "./a/readme.txt";
        import b from "./b/readme.txt";
        import sameA from "./a/same.txt";
        import sameB from "./b/same.txt";
        import icon from "./a/icon.file" with { type: "file" };
        console.log(JSON.stringify({ a, b, sameA, sameB, icon: await Bun.file(icon).text() }));
      `,
      "/a/readme.txt": "from a",
      "/b/readme.txt": "from b",
      "/a/same.txt": "same",
      "/b/same.txt": "same",
      "/a/icon.file": "icon",
    },
    run: { stdout: JSON.stringify({ a: "from a", b: "from b", sameA: "same", sameB: "same", icon: "icon" }) },
  });

  // A browser chunk of a full-stack executable cannot reach the embedded
  // module graph, so its text imports stay inline string literals.
  itBundled("compile/TextImportClientChunkStaysInline", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import index from "./index.html";
        import note from "./note.txt";
        using server = Bun.serve({ port: 0, routes: { "/": index } });
        const html = await (await fetch(server.url)).text();
        const src = html.match(/<script[^>]*src="([^"]+)"/)[1];
        const js = await (await fetch(new URL(src, server.url))).text();
        console.log(JSON.stringify({
          server: note,
          clientHasLiteral: js.includes("client sees the text"),
          clientHasBunfs: js.includes("$bunfs"),
        }));
      `,
      "/index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <body>
            <script type="module" src="./app.ts"></script>
          </body>
        </html>
      `,
      "/app.ts": /* js */ `
        import note from "./note.txt";
        document.body.textContent = note;
      `,
      "/note.txt": "client sees the text",
    },
    run: { stdout: JSON.stringify({ server: "client sees the text", clientHasLiteral: true, clientHasBunfs: false }) },
  });
  itBundled("compile/Utf8", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log(JSON.stringify({\u{6211}: "\u{6211}"}));
      `,
    },
    run: { stdout: '{"\u{6211}":"\u{6211}"}' },
  });
  itBundled("compile/ImportMetaMain", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        // test toString on function to observe what the inlined value was
        console.log((() => import.meta.main).toString().includes('true'));
        console.log((() => !import.meta.main).toString().includes('false'));
        console.log((() => !!import.meta.main).toString().includes('true'));
        console.log((() => require.main == module).toString().includes('true'));
        console.log((() => require.main === module).toString().includes('true'));
        console.log((() => require.main !== module).toString().includes('false'));
        console.log((() => require.main !== module).toString().includes('false'));
      `,
    },
    run: { stdout: new Array(7).fill("true").join("\n") },
  });
  itBundled("compile/SourceMap", {
    target: "bun",
    compile: true,
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
    sourceMap: "external",
    onAfterBundle(api) {
      rmSync(api.join("entry.ts"), {}); // Hide the source files for errors
    },
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
  itBundled("compile/SourceMapBigFile", {
    target: "bun",
    compile: true,
    files: {
      "/entry.ts": /* js */ `import * as ReactDom from ${JSON.stringify(require.resolve("react-dom/server"))};

// this file has comments and weird whitespace, intentionally
// to make it obvious if sourcemaps were generated and mapped properly
if           (true) code();
function code() {
  // hello world
          throw   new
    Error("Hello World");
}

console.log(ReactDom);`,
    },
    sourceMap: "external",
    onAfterBundle(api) {
      rmSync(api.join("entry.ts"), {}); // Hide the source files for errors
    },
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toStartWith(
          `3 | // this file has comments and weird whitespace, intentionally
4 | // to make it obvious if sourcemaps were generated and mapped properly
5 | if           (true) code();
6 | function code() {
7 |   // hello world
8 |           throw   new
                      ^
error: Hello World`,
        );
        expect(stderr).toInclude("entry.ts:8:19");
      },
    },
  });
  itBundled("compile/BunBeBunEnvVar", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log("This is compiled code");
        console.log(JSON.stringify({ isStandaloneExecutable: Bun.isStandaloneExecutable }));
      `,
    },
    run: [
      {
        stdout: `This is compiled code\n{"isStandaloneExecutable":true}`,
      },
      {
        env: { BUN_BE_BUN: "1" },
        validate({ stdout }) {
          expect(stdout).not.toContain("This is compiled code");
        },
      },
      {
        // With BUN_BE_BUN=1 the compiled executable behaves like the plain `bun` CLI:
        // the embedded standalone module graph is never loaded, so Bun.isStandaloneExecutable
        // must be false even though the binary itself contains one.
        env: { BUN_BE_BUN: "1" },
        args: [
          "-e",
          `console.log(JSON.stringify({ isStandaloneExecutable: Bun.isStandaloneExecutable, type: typeof Bun.isStandaloneExecutable }))`,
        ],
        stdout: `{"isStandaloneExecutable":false,"type":"boolean"}`,
      },
    ],
  });

  test("does not crash", async () => {
    await using dir = tempDir("bundler-compile-shadcn", {
      "frontend.tsx": `console.log("Hello, world!");`,
      "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bun + React</title>
    <script type="module" src="./frontend.tsx" async></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
        `,
      "index.tsx": `import { serve } from "bun";
import index from "./index.html";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: "LOL",
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

`,
    });

    // Step 2: Run bun build with compile, minify, sourcemap, and bytecode
    await Bun.$`${bunExe()} build ./index.tsx --compile --minify --sourcemap --bytecode`
      .cwd(dir)
      .env(bunEnv)
      .throws(true);
  }, 30_000);

  // Verify ESM bytecode is actually loaded from the cache at runtime, not just generated.
  // Uses regex matching on stderr (not itBundled) since we don't know the exact
  // number of cache hit/miss lines for ESM standalone.
  test("ESM bytecode cache is used at runtime", async () => {
    const ext = isWindows ? ".exe" : "";
    using dir = tempDir("esm-bytecode-cache", {
      "entry.js": `console.log("esm bytecode loaded");`,
    });

    const outfile = join(String(dir), `app${ext}`);

    // Build with ESM + bytecode
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format=esm",
        join(String(dir), "entry.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Run with verbose disk cache to verify bytecode is loaded
    await using exe = Bun.spawn({
      cmd: [outfile],
      env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, exeStderr, exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toContain("esm bytecode loaded");
    expect(exeStderr).toMatch(/\[Disk Cache\].*Cache hit/i);
    expect(exeExitCode).toBe(0);
  }, 30_000);

  // When compiling with 8+ entry points, the main entry point should still run correctly.
  test("compile with 8+ entry points runs main entry correctly", async () => {
    await using dir = tempDir("compile-many-entries", {
      "app.js": `console.log("IT WORKS");`,
      "assets/file-1": "",
      "assets/file-2": "",
      "assets/file-3": "",
      "assets/file-4": "",
      "assets/file-5": "",
      "assets/file-6": "",
      "assets/file-7": "",
      "assets/file-8": "",
    });

    await Bun.$`${bunExe()} build --compile app.js assets/* --outfile app`.cwd(dir).env(bunEnv).throws(true);

    const result = await Bun.$`./app`.cwd(dir).env(bunEnv).nothrow();
    expect(result.stdout.toString().trim()).toBe("IT WORKS");
  }, 30_000);
});

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_X86_64 = 0x01000007;
const MH_EXECUTE = 2;
const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 0x2;

// Minimal Mach-O "base executable" for --compile-executable-path: a __BUN segment with one
// __bun section followed by a 0x100-byte __LINKEDIT segment, plus an optional LC_SYMTAB whose
// symbol table starts at __LINKEDIT and whose string table sits 0x80 bytes in.
// `bunFileOff`/`bunFileSize` are where the load commands claim the __BUN data lives;
// `fileSize` is how many bytes the template actually contains.
function machoTemplate({
  bunFileOff = 0x4000,
  bunFileSize = 0x4000,
  fileSize = 0x8100,
  linkeditFileOff = bunFileOff + bunFileSize,
  symtab = false,
}: {
  bunFileOff?: number;
  bunFileSize?: number;
  fileSize?: number;
  linkeditFileOff?: number;
  symtab?: boolean;
} = {}): Buffer {
  const segCmdSize = 72; // sizeof(segment_command_64)
  const sectSize = 80; // sizeof(section_64)
  const symtabCmdSize = 24; // sizeof(symtab_command)
  const sizeofcmds = segCmdSize + sectSize + segCmdSize + (symtab ? symtabCmdSize : 0);
  const buf = Buffer.alloc(fileSize);
  const writeName = (off: number, name: string) => buf.write(name, off, 16, "latin1");

  // mach_header_64
  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeInt32LE(CPU_TYPE_X86_64, 4);
  buf.writeInt32LE(3, 8); // cpusubtype
  buf.writeUInt32LE(MH_EXECUTE, 12);
  buf.writeUInt32LE(symtab ? 3 : 2, 16); // ncmds
  buf.writeUInt32LE(sizeofcmds, 20);

  // LC_SEGMENT_64 __BUN with one section
  let o = 32;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize + sectSize, o + 4); // cmdsize
  writeName(o + 8, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(BigInt(bunFileSize), o + 32); // vmsize
  buf.writeBigUInt64LE(BigInt(bunFileOff), o + 40); // fileoff
  buf.writeBigUInt64LE(BigInt(bunFileSize), o + 48); // filesize
  buf.writeInt32LE(7, o + 56); // maxprot
  buf.writeInt32LE(3, o + 60); // initprot
  buf.writeUInt32LE(1, o + 64); // nsects

  // section_64 __bun
  o += segCmdSize;
  writeName(o, "__bun");
  writeName(o + 16, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 32); // addr
  buf.writeBigUInt64LE(BigInt(bunFileSize), o + 40); // size
  buf.writeUInt32LE(bunFileOff, o + 48); // offset
  buf.writeUInt32LE(14, o + 52); // align = 2^14

  // LC_SEGMENT_64 __LINKEDIT
  o += sectSize;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__LINKEDIT");
  buf.writeBigUInt64LE(0x1_0001_0000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x1000n, o + 32); // vmsize
  buf.writeBigUInt64LE(BigInt(linkeditFileOff), o + 40); // fileoff
  buf.writeBigUInt64LE(0x100n, o + 48); // filesize
  buf.writeInt32LE(1, o + 56); // maxprot
  buf.writeInt32LE(1, o + 60); // initprot

  if (symtab) {
    // LC_SYMTAB
    o += segCmdSize;
    buf.writeUInt32LE(LC_SYMTAB, o);
    buf.writeUInt32LE(symtabCmdSize, o + 4);
    buf.writeUInt32LE(linkeditFileOff, o + 8); // symoff
    buf.writeUInt32LE(0, o + 12); // nsyms
    buf.writeUInt32LE(linkeditFileOff + 0x80, o + 16); // stroff
    buf.writeUInt32LE(0x80, o + 20); // strsize
  }

  return buf;
}

test("compile --compile-executable-path rejects a Mach-O template whose __BUN segment offsets exceed the file bounds", async () => {
  // `bun build --compile --target=bun-darwin-*` patches the application bundle into the
  // __BUN,__bun section of the base executable named by --compile-executable-path. The
  // segment/section offsets in that file's load commands must be validated against the
  // actual file size before they are used as memmove destinations.
  using dir = tempDir("compile-macho-template-bounds", {
    "entry.js": `console.log("compiled-from-template");`,
  });
  const cwd = String(dir);

  for (const [name, bytes, wantErr] of [
    // __BUN fileoff points 1 GiB past the end of the 33 KB file.
    ["fileoff-past-eof", machoTemplate({ bunFileOff: 0x40000000 }), "OffsetOutOfRange"],
    // __BUN filesize (32 KB) exceeds the 256-byte file: the bounds check must reject this
    // before the growth `reserve()` (which would otherwise see a negative size_diff).
    ["filesize-past-eof", machoTemplate({ bunFileOff: 0, bunFileSize: 0x8000, fileSize: 256 }), "OffsetOutOfRange"],
  ] as const) {
    const badTemplate = join(cwd, `template-${name}`);
    await Bun.write(badTemplate, bytes);
    const outBad = join(cwd, `out-${name}`);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-x64",
        "--compile-executable-path",
        badTemplate,
        join(cwd, "entry.js"),
        "--outfile",
        outBad,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The invalid template must be reported as a clean error...
    expect({ name, stderr }).toEqual({ name, stderr: expect.stringContaining(wantErr) });
    // ...no output executable is produced...
    expect(await Bun.file(outBad).exists()).toBe(false);
    // ...and the build exits with a normal failure code instead of crashing.
    expect(exitCode).toBe(1);
  }

  // The same template with in-bounds offsets is still accepted.
  const goodTemplate = join(cwd, "template-good");
  await Bun.write(goodTemplate, machoTemplate());
  const outGood = join(cwd, "out-good");
  {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-x64",
        "--compile-executable-path",
        goodTemplate,
        join(cwd, "entry.js"),
        "--outfile",
        outGood,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("OffsetOutOfRange");
    const outBytes = Buffer.from(await Bun.file(outGood).arrayBuffer());
    expect(outBytes.includes("compiled-from-template")).toBe(true);
    expect(exitCode).toBe(0);
  }

  // __BUN filesize (32 KB) is in-bounds but larger than the 16 KB aligned bundle slot, as in a
  // template that is itself a compiled executable. write_section only grows, so the segment
  // keeps its size, nothing behind it moves, and what the bundle leaves of the slot is zeroed.
  const largerTemplate = join(cwd, "template-larger-slot");
  const largerBytes = machoTemplate({ bunFileSize: 0x8000, fileSize: 0xc100 });
  largerBytes.fill(0xaa, 0x4000, 0xc000);
  await Bun.write(largerTemplate, largerBytes);
  const outLarger = join(cwd, "out-larger-slot");
  {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-x64",
        "--compile-executable-path",
        largerTemplate,
        join(cwd, "entry.js"),
        "--outfile",
        outLarger,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("InvalidObject");
    const outBytes = Buffer.from(await Bun.file(outLarger).arrayBuffer());
    const bundleSize = Number(outBytes.readBigUInt64LE(0x4000));
    const segment = 32; // LC_SEGMENT_64 __BUN
    const section = segment + 72;
    const linkedit = section + 80;
    expect({
      vmsize: Number(outBytes.readBigUInt64LE(segment + 32)),
      fileoff: Number(outBytes.readBigUInt64LE(segment + 40)),
      filesize: Number(outBytes.readBigUInt64LE(segment + 48)),
      sectionSize: Number(outBytes.readBigUInt64LE(section + 40)),
      linkeditFileOff: Number(outBytes.readBigUInt64LE(linkedit + 40)),
    }).toEqual({
      vmsize: 0x8000,
      fileoff: 0x4000,
      filesize: 0x8000,
      sectionSize: 8 + bundleSize,
      linkeditFileOff: 0xc000,
    });
    expect(bundleSize).toBeLessThan(0x4000);
    expect(outBytes.subarray(0x4008, 0x4008 + bundleSize).includes("compiled-from-template")).toBe(true);
    expect(outBytes.subarray(0x4008 + bundleSize, 0xc000).every(byte => byte === 0)).toBe(true);
    expect(exitCode).toBe(0);
  }
}, 60_000);

test("compile --compile-executable-path rejects a Mach-O template whose __LINKEDIT offsets would pass 4 GiB once the bundle is embedded", async () => {
  // Mach-O load commands (LC_SYMTAB, LC_CODE_SIGNATURE, ...) store file offsets as u32.
  // Embedding the bundle grows __BUN and moves every __LINKEDIT offset forward by the same
  // amount, so a bundle of about 4 GiB pushes them past u32::MAX. Building such a bundle
  // is too slow for a test, so this template places __LINKEDIT and the LC_SYMTAB offsets
  // just below 4 GiB: a 32 KB bundle is then enough to move them over the edge.

  // Returns the __LINKEDIT fileoff and the LC_SYMTAB offsets of a Mach-O file.
  function readLinkeditOffsets(buf: Buffer) {
    const ncmds = buf.readUInt32LE(16);
    let linkeditFileOff = -1;
    let symoff = -1;
    let stroff = -1;
    let o = 32;
    for (let i = 0; i < ncmds; i++) {
      const cmd = buf.readUInt32LE(o);
      const cmdsize = buf.readUInt32LE(o + 4);
      if (cmd === LC_SEGMENT_64 && buf.toString("latin1", o + 8, o + 18) === "__LINKEDIT") {
        linkeditFileOff = Number(buf.readBigUInt64LE(o + 40));
      } else if (cmd === LC_SYMTAB) {
        symoff = buf.readUInt32LE(o + 8);
        stroff = buf.readUInt32LE(o + 16);
      }
      o += cmdsize;
    }
    return { linkeditFileOff, symoff, stroff };
  }

  // 32 KB of source does not fit the template's 16 KB __BUN slot, so __LINKEDIT has to move.
  using dir = tempDir("compile-macho-template-4gib", {
    "entry.js": `console.log("${Buffer.alloc(32 * 1024, "a").toString()}");`,
  });
  const cwd = String(dir);

  const build = async (name: string, template: Buffer) => {
    const templatePath = join(cwd, `template-${name}`);
    await Bun.write(templatePath, template);
    const outfile = join(cwd, `out-${name}`);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-x64",
        "--compile-executable-path",
        templatePath,
        join(cwd, "entry.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, exitCode, outfile };
  };

  // __LINKEDIT starts 4 KiB below 4 GiB, so any growth of __BUN (16 KiB steps) overflows its offsets.
  {
    const { stderr, exitCode, outfile } = await build(
      "too-large",
      machoTemplate({ linkeditFileOff: 0xffff_f000, symtab: true }),
    );
    expect(stderr).toContain("executable would exceed 4 GiB");
    expect(stderr).toContain("failed to write compiled executable");
    expect(await Bun.file(outfile).exists()).toBe(false);
    expect(exitCode).toBe(1);
  }

  // The same template with __LINKEDIT right after __BUN builds, and its offsets move together.
  {
    const { stderr, exitCode, outfile } = await build("in-range", machoTemplate({ symtab: true }));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const out = Buffer.from(await Bun.file(outfile).arrayBuffer());
    const { linkeditFileOff, symoff, stroff } = readLinkeditOffsets(out);
    expect(linkeditFileOff).toBeGreaterThan(0x8000);
    expect({ symoff, stroff }).toEqual({ symoff: linkeditFileOff, stroff: linkeditFileOff + 0x80 });
  }
});

test("compile --compile-executable-path rejects a template shorter than the executable-format header", async () => {
  // `--compile-executable-path` accepts an arbitrary file. A file shorter than the target
  // format's fixed header (or one whose header advertises more load-command bytes than the
  // file contains) must surface as a clean error instead of a slice-index panic.
  using dir = tempDir("compile-template-short-header", {
    "entry.js": `console.log(1);`,
    // 19 bytes: shorter than mach_header_64 (32), Elf64_Ehdr (64), IMAGE_DOS_HEADER (64).
    "tiny": "WRONG-STUB-FALLBACK",
  });
  const cwd = String(dir);

  const machHeader = (ncmds: number, sizeofcmds: number) => {
    const b = Buffer.alloc(32);
    b.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
    b.writeInt32LE(0x01000007, 4); // CPU_TYPE_X86_64
    b.writeInt32LE(3, 8); // cpusubtype
    b.writeUInt32LE(2, 12); // filetype = MH_EXECUTE
    b.writeUInt32LE(ncmds, 16);
    b.writeUInt32LE(sizeofcmds, 20);
    return b;
  };

  // mach_header_64 with ncmds=2 sizeofcmds=10000 but only 8 trailing bytes — exercises the
  // load-command-table bounds check in MachoFile::init (iterator() would otherwise slice OOB).
  await Bun.write(join(cwd, "badcmds"), Buffer.concat([machHeader(2, 10000), Buffer.alloc(8)]));

  // mach_header_64 + one LC_SEGMENT_64 whose cmdsize (8) is smaller than sizeof(segment_command_64)
  // (72) — exercises the cast-site guard in write_section().
  const lc = Buffer.alloc(8);
  lc.writeUInt32LE(0x19, 0); // LC_SEGMENT_64
  lc.writeUInt32LE(8, 4); // cmdsize
  await Bun.write(join(cwd, "shortseg"), Buffer.concat([machHeader(1, 8), lc]));

  const run = async (target: string, template: string) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        `--target=${target}`,
        "--compile-executable-path",
        join(cwd, template),
        join(cwd, "entry.js"),
        "--outfile",
        join(cwd, `out-${template}`),
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  for (const [target, template, wantErr, outName] of [
    ["bun-darwin-x64", "tiny", "InvalidObject", "out-tiny"],
    ["bun-darwin-x64", "badcmds", "InvalidObject", "out-badcmds"],
    ["bun-darwin-x64", "shortseg", "InvalidObject", "out-shortseg"],
    ["bun-linux-x64", "tiny", "InvalidElfFile", "out-tiny"],
    // build_command.rs appends .exe to the outfile for Windows targets.
    ["bun-windows-x64", "tiny", "InvalidPEFile", "out-tiny.exe"],
  ] as const) {
    const { stderr, exitCode } = await run(target, template);
    expect({ target, template, stderr }).toEqual({
      target,
      template,
      stderr: expect.stringContaining(wantErr),
    });
    expect(await Bun.file(join(cwd, outName)).exists()).toBe(false);
    expect(exitCode).toBe(1);
  }
}, 60_000);

// The startup path used to release weak refs, drop every unlinked code block and run a synchronous full collection right
// after a standalone executable's entry module finished evaluating, i.e. before its first turn of the event loop.
test("a standalone executable does not run a synchronous full GC after loading its entry point", async () => {
  using dir = tempDir("compile-no-postload-gc", {
    "app.js": `setTimeout(() => console.log("done"), 1);`,
  });
  const cwd = String(dir);
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", "app"],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildStderr).not.toContain("error");
  expect(buildExit).toBe(0);
  await using proc = Bun.spawn({
    cmd: [join(cwd, isWindows ? "app.exe" : "app")],
    // BUN_DESTRUCT_VM_ON_EXIT would add an exit-time full collection to the log.
    env: { ...bunEnv, BUN_JSC_logGC: "1", BUN_DESTRUCT_VM_ON_EXIT: undefined },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("done\n");
  // Heap::notifyIsSafeToCollect logs this at VM creation whenever logGC is on, collection or not, so it proves the
  // option reached the compiled binary without depending on any GC happening.
  expect(stderr).toMatch(/\[GC<(0x)?[0-9a-fA-F]+>: starting /); // %p: "0x7f…" on POSIX, "00007FF6…" on Windows
  expect(stderr).not.toContain("FullCollection");
  expect(exitCode).toBe(0);
});
