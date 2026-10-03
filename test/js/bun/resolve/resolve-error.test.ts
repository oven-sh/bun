import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";

describe("ResolveMessage", () => {
  it("position object does not segfault", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(Bun.inspect(e.position).length > 0).toBe(true);
      expect(e.column).toBeGreaterThanOrEqual(0);
      expect(e.line).toBeGreaterThanOrEqual(0);
    }
  });

  it(".message is modifiable", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      const orig = e.message;
      expect(() => (e.message = "new message")).not.toThrow();
      expect(e.message).toBe("new message");
      expect(e.message).not.toBe(orig);
    }
  });

  it("has code for esm", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(e.code).toBe("ERR_MODULE_NOT_FOUND");
    }
  });

  it("has code for require.resolve", () => {
    try {
      require.resolve("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(e.code).toBe("MODULE_NOT_FOUND");
    }
  });

  it("has code for require", () => {
    try {
      require("./file-importing-nonexistent-file.cjs");
    } catch (e: any) {
      expect(e.code).toBe("MODULE_NOT_FOUND");
    }
  });

  it("preserves non-ASCII specifier in .message and .specifier (import)", async () => {
    const spec = "./caf\u00e9-missing-\u{1F389}";
    let err: any;
    try {
      await import(spec);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.name).toBe("ResolveMessage");
    expect(err.specifier).toBe(spec);
    expect(err.message).toContain(spec);
    expect(String(err)).toContain(spec);
    expect(JSON.parse(JSON.stringify(err))).toMatchObject({ specifier: spec });
  });

  it("preserves non-ASCII specifier in .message and .specifier (require node:)", () => {
    const spec = "node:sql\u0131te"; // dotless i U+0131
    let err: any;
    try {
      require(spec);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("ERR_UNKNOWN_BUILTIN_MODULE");
    expect(err.specifier).toBe(spec);
    expect(err.message).toBe(`No such built-in module: ${spec}`);
  });

  it("preserves non-ASCII referrer in .referrer and .message", () => {
    const referrer = "/tmp/caf\u00e9-tr\u00e8s-\u{1F389}/file.js";
    let err: any;
    try {
      Bun.resolveSync("./does-not-exist", referrer);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.referrer).toBe(referrer);
    expect(err.message).toContain(referrer);
  });

  it("preserves non-ASCII in position.lineText and position.file", async () => {
    const lineText = `const caf\u00e9 = 1; import "./na\u00efve-missing.js"; // \u{1F389}`;
    const fileName = "entry-caf\u00e9-\u{1F389}.js";
    using dir = tempDir("resolve-position-utf8", {
      [fileName]: lineText + "\n",
    });
    const result = await Bun.build({ entrypoints: [path.join(String(dir), fileName)], throw: false });
    expect(result.success).toBe(false);
    const log: any = result.logs.find(l => l.name === "ResolveMessage");
    expect(log).toBeDefined();
    expect(log.position.lineText).toBe(lineText);
    expect(path.basename(log.position.file)).toBe(fileName);
    expect(log.specifier).toBe("./na\u00efve-missing.js");
  });

  it("invalid data URL import", async () => {
    expect(async () => {
      // @ts-ignore
      await import("data:Hello%2C%20World!");
    }).toThrow("Cannot resolve invalid data URL");
  });

  it("doesn't crash", async () => {
    expect(async () => {
      // @ts-ignore
      await import(":://filesystem");
    }).toThrow("Cannot find package '::'");
  });

  it("referrer is not freed before it is read", () => {
    // Non-ASCII in the source path forces resolveMaybeNeedsTrailingSlash to
    // allocate a new UTF-8 buffer which is freed on return. ResolveMessage
    // used to borrow that buffer for .referrer, causing a use-after-free
    // when the property was read later.
    let err: any;
    try {
      Bun.resolveSync("./does-not-exist", "/tmp/caf\u00e9-tr\u00e8s-long-\u{1F389}/file.js");
    } catch (e) {
      err = e;
    }
    Bun.gc(true);
    expect(err.referrer).toStartWith("/tmp/caf");
    expect(err.referrer).toEndWith("/file.js");
  });

  it("finalize frees with the same allocator it was created with", () => {
    // ResolveMessage.create() clones the message with the VM's arena
    // allocator but finalize() was freeing it with bun.default_allocator
    // and never destroying the struct itself. Under ASAN with mimalloc's
    // per-heap tracking this surfaced as a flaky use-after-poison in the
    // resolver after many failed require()s + GCs in a long-running
    // process (Fuzzilli REPRL). Use relative specifiers so auto-install
    // does not kick in.
    for (let i = 0; i < 50; i++) {
      let errs: any[] = [];
      for (let j = 0; j < 10; j++) {
        try {
          Bun.resolveSync("./does-not-exist-" + j, import.meta.dir);
        } catch (e) {
          errs.push(e);
        }
      }
      for (const e of errs) {
        void e.message;
        void e.code;
        void e.specifier;
        void e.referrer;
        void e.level;
        void e.importKind;
        void e.position;
        void String(e);
      }
      errs = [];
      Bun.gc(true);
    }
    expect().pass();
  });
});

// These tests reproduce panics where the module resolver wrote past fixed-size
// PathBuffers when given very long import specifiers. The bug triggers when
// `import_path < PATH_MAX` but `baseUrl + import_path > PATH_MAX` (otherwise a
// syscall returns ENAMETOOLONG first). PATH_MAX is 1024 on macOS, 4096 on
// Linux/Windows, so pick a length just under it per platform.
// Any length > 512 also exercises the `esm_subpath` buffer.
describe.concurrent("long import path overflow", () => {
  const len = process.platform === "darwin" ? 1020 : 4090;
  // "a".repeat is slow in debug builds; use Buffer.alloc instead.
  const long = Buffer.alloc(len, "a").toString();

  function makeDir() {
    // package.json + node_modules/ prevent the resolver from attempting
    // auto-install (which has an unrelated pre-existing bug).
    return tempDir("resolve-long-path", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      "tsconfig.json": `{"compilerOptions": {"baseUrl": ".", "paths": {"@x/*": ["./src/*"]}}}`,
    });
  }

  async function run(dir: string, importExpr: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { await import(${importExpr}); } catch {} console.log("ok");`],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  }

  it("bare package specifier (tsconfig baseUrl + import_path join)", async () => {
    using dir = makeDir();
    // normalizeStringGenericTZ: `@memcpy(buf[buf_i..][0..count], ...)` past PathBuffer
    await run(String(dir), `\`@nonexistent/pkg/build/${long}.js\``);
  });

  it("tsconfig paths wildcard (matched text captured from import path)", async () => {
    using dir = makeDir();
    // matchTSConfigPaths: bun.concat into fixed tsconfig_match_full_buf3
    await run(String(dir), `\`@x/${long}\``);
  });

  it("relative path (source_dir + import_path join)", async () => {
    using dir = makeDir();
    // checkRelativePath / resolveWithoutRemapping absBuf
    await run(String(dir), `\`./${long}.js\``);
  });

  it("relative path full of `..` segments (exercises normalization fallback)", async () => {
    using dir = makeDir();
    // Concat length >> PATH_MAX but normalizes down; JoinScratch heap fallback
    await run(String(dir), `\`./\${"x/../".repeat(${len})}${long}.js\``);
  });

  it("absolute path longer than PATH_MAX (dirInfoCached buffer)", async () => {
    using dir = makeDir();
    // dirInfoCachedMaybeLog: bun.copy into dir_info_uncached_path
    await run(String(dir), `\`/${long}/mixed\``);
  });

  it("absolute path with >256 short components (dir_entry_paths_to_resolve queue)", async () => {
    using dir = makeDir();
    // Walk-up loop indexed into a fixed [256]DirEntryResolveQueueItem
    await run(String(dir), `\`/\${"a/".repeat(300)}x\``);
  });
});

// matchTSConfigPaths sliced `path[prefix.len()..path.len() - suffix.len()]`
// after only checking starts_with/ends_with. When the prefix and suffix bytes
// overlap inside the import path (e.g. key "ab*ba" vs import "aba"), the slice
// start exceeds the end and Rust panics.
describe.concurrent("tsconfig paths wildcard with overlapping prefix/suffix", () => {
  async function run(key: string, specifier: string) {
    using dir = tempDir("tsconfig-paths-overlap", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { [key]: ["./impl/*"] } },
      }),
      "main.ts": `try { require(${JSON.stringify(specifier)}); } catch (e) { console.log("ERR:" + e.code); }`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "ERR:MODULE_NOT_FOUND",
      stderr: "",
      exitCode: 0,
    });
  }

  it("ab*ba vs aba", async () => {
    await run("ab*ba", "aba");
  });

  it("test*test vs testest", async () => {
    await run("test*test", "testest");
  });

  it("xy*xy vs xy", async () => {
    await run("xy*xy", "xy");
  });
});

// Bun.resolve() resolves synchronously and returns an already-settled promise.
// A rejected one has to be reported like any other unhandled rejection.
describe.concurrent("Bun.resolve() rejections are tracked", () => {
  async function run(body: string) {
    using dir = tempDir("bun-resolve-unhandled", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const dir = ${JSON.stringify(String(dir))};\n${body}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("an unhandled rejection is reported", async () => {
    const { stdout, stderr, exitCode } = await run(`Bun.resolve("./does-not-exist", dir);`);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module './does-not-exist'");
    expect(exitCode).toBe(1);
  });

  it("the returned promise is the one passed to 'unhandledRejection'", async () => {
    const { stdout, stderr, exitCode } = await run(`
      process.on("unhandledRejection", (reason, promise) => {
        console.log(reason.code, promise === p);
      });
      const p = Bun.resolve("./does-not-exist", dir);
    `);
    expect(stdout).toBe("ERR_MODULE_NOT_FOUND true\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("a handled rejection is not reported", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Bun.resolve("./does-not-exist", dir).catch(e => console.log("caught", e.code));
    `);
    expect(stdout).toBe("caught ERR_MODULE_NOT_FOUND\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// Bun.resolve() allocates its rejected promise while the exception the resolve
// threw is still pending on the VM. That allocation is a GC safepoint, and the
// concurrent collector's end phase materializes the stack of every live Error
// whose frames died, through the onComputeErrorInfo hook. The hook used to
// clear whatever exception was pending, so the rejection then found nothing:
// `panic: A JavaScript exception was thrown, but it was cleared before it could be read.`
//
// Each call comes from a fresh closure and the reasons are kept in a ring, so
// every collection has live Errors with a dead top frame to materialize. The
// calls have to be awaited one at a time (64 per tick never fires), and
// collectContinuously keeps an end phase always imminent. The unfixed debug
// build panics after 2500 to 8500 iterations. Not concurrent with the tests
// above: a busy machine starves the collector and hides the race.
//
// Skipped on Windows: collectContinuously is several times slower under
// Windows + ASAN in CI, and the fixed C++ path is not platform-specific.
it.skipIf(isWindows)(
  "Bun.resolve() rejection survives a GC stack-trace finalizer",
  async () => {
    using dir = tempDir("bun-resolve-rejection-gc", {
      "fixture.mjs": `
        const keep = [];
        let rejections = 0;
        for (let i = 0; i < 20000; i++) {
          const call = () => Bun.resolve();
          await call().catch(e => {
            rejections++;
            keep.push(e);
            if (keep.length > 1024) keep.shift();
          });
        }
        console.log("ok rejections=" + rejections);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok rejections=20000", exitCode: 0 });
    void stderr;
  },
  // 20000 awaited rejections under collectContinuously on a debug+ASAN build
  // take well over the default 5s.
  120_000,
);

describe.concurrent("Node 24 package configuration validation", () => {
  async function run(files: Record<string, string>, source: string) {
    using dir = tempDir("package-config", { "package.json": "{}", ...files, "driver.mjs": source });
    await using child = Bun.spawn({
      cmd: [bunExe(), "--no-install", "driver.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect({ stdout: stdout.trim().replaceAll(String(dir), "<root>"), stderr, exitCode }).toEqual({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
  }

  it.each(["import", "require"])("defers selected malformed package metadata for %s", async mode => {
    await run(
      {
        "pkg/package.json": JSON.stringify({ imports: { "#selected": { node: "bad", default: "good" } } }),
        "pkg/node_modules/bad/package.json": "invalid JSON",
        "pkg/node_modules/bad/index.cjs": "module.exports = 42;",
        "pkg/node_modules/good/package.json": '{"main":"index.cjs"}',
        "pkg/node_modules/good/index.cjs": "module.exports = 7;",
        "pkg/entry.mjs": "export const read = () => import('#selected');",
        "pkg/entry.cjs": "exports.read = () => require('#selected');",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       const entry = ${mode === "import" ? "await import('./pkg/entry.mjs')" : "createRequire(import.meta.url)('./pkg/entry.cjs')"};
       await assert.rejects(async () => entry.read(), {
         name: 'Error', code: 'ERR_INVALID_PACKAGE_CONFIG',
         message: 'Invalid package config ' + join(process.cwd(), 'pkg/node_modules/bad/package.json') +
           ' while importing "bad" from ' + join(process.cwd(), 'pkg/package.json') + '.',
       });
       console.log('ok');`,
    );
  });

  it.each([
    "",
    " \n",
    "{",
    "null",
    "[]",
    "42",
    '{"type":null}',
    '{"name":42}',
    '{"type":null,"type":"commonjs"}',
    '{"type":"module","type":null}',
  ])("validates a selected scope without poisoning explicit extensions or nested scopes: %j", async contents => {
    await run(
      {
        "bad/package.json": contents,
        "bad/value.js": "module.exports = 42;",
        "bad/value.cjs": "module.exports = 42;",
        "bad/value.mjs": "export default 42;",
        "bad/nested/package.json": "{}",
        "bad/nested/value.js": "module.exports = 42;",
      },
      `import assert from 'node:assert/strict';
         import {createRequire} from 'node:module';
         import {join} from 'node:path';
         const require = createRequire(import.meta.url);
         const expected = {name:'Error', code:'ERR_INVALID_PACKAGE_CONFIG', message:'Invalid package config ' + join(process.cwd(),'bad/package.json') + '.'};
         await assert.rejects(import('./bad/value.js'), expected);
         assert.throws(() => require('./bad/value.js'), expected);
         for (const file of ['./bad/value.cjs','./bad/value.mjs','./bad/nested/value.js']) {
           assert.equal((await import(file)).default, 42);
           const value = require(file);
           assert.equal(typeof value === 'number' ? value : value.default, 42);
         }
         console.log('ok');`,
    );
  });

  it("validates existing ESM resolve-only scopes while deferring require.resolve", async () => {
    await run(
      {
        "bad/package.json": "invalid JSON",
        "bad/value": "",
        "bad/.hidden": "",
        "bad/value.js": "",
        "bad/value.ts": "",
        "bad/value.mjs": "",
        "bad/value.cjs": "",
        "bad/value.mts": "",
        "bad/value.cts": "",
        "bad/value.jsx": "",
        "bad/value.tsx": "",
        "bad/value.json": "{}",
        "bad/value.wasm": "",
        "bad/value.css": "",
        "bad/nested/package.json": "{}",
        "bad/nested/value.js": "",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       import {pathToFileURL} from 'node:url';
       const require = createRequire(import.meta.url);
       const expected = {code:'ERR_INVALID_PACKAGE_CONFIG',message:'Invalid package config '+join(process.cwd(),'bad/package.json')+'.'};
       for(const invalid of ['./bad/value.js','./bad/value.ts','./bad/value','./bad/.hidden']) {
         assert.throws(() => import.meta.resolve(invalid), expected);
         assert.throws(() => import.meta.resolve(pathToFileURL(join(process.cwd(),invalid)).href), expected);
         assert.equal(require.resolve(invalid),join(process.cwd(),invalid));
         await assert.rejects(import(invalid), expected);
       }
       assert.deepEqual(Object.keys(require('./bad/value')),[]);
       for(const file of ['./bad/value.mjs','./bad/value.cjs','./bad/value.mts','./bad/value.cts','./bad/value.jsx','./bad/value.tsx','./bad/value.json','./bad/value.wasm','./bad/value.css','./bad/nested/value.js','./bad/missing.js']) {
         assert.equal(import.meta.resolve(file),pathToFileURL(join(process.cwd(),file)).href);
       }
       console.log('ok');`,
    );
  });

  // Creating file symlinks requires additional privileges on Windows.
  it.skipIf(isWindows)("validates the real scope of a resolve-only symlink", async () => {
    await run(
      { "bad/package.json": "invalid JSON", "bad/value.js": "", "good.js": "" },
      `import assert from 'node:assert/strict';
       import {symlinkSync} from 'node:fs';
       import {join} from 'node:path';
       symlinkSync('bad/value.js','link.js');
       symlinkSync('../good.js','bad/good-link.js');
       assert.throws(() => import.meta.resolve('./link.js'), {
         code:'ERR_INVALID_PACKAGE_CONFIG',message:'Invalid package config '+join(process.cwd(),'bad/package.json')+'.',
       });
       assert.equal(typeof import.meta.resolve('./bad/good-link.js'),'string');
       console.log('ok');`,
    );
  });

  it("reports the last malformed scope before reaching valid parent metadata", async () => {
    await run(
      {
        "outer/package.json": "invalid JSON",
        "outer/inner/package.json": "invalid JSON",
        "outer/inner/value.js": "module.exports=42;",
        "outer/inner/entry.mjs": "export const read=()=>import('missing-package');",
        "outer/inner/entry.cjs": "exports.read=()=>require('missing-package');",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       const require=createRequire(import.meta.url);
       const expected={code:'ERR_INVALID_PACKAGE_CONFIG',message:'Invalid package config '+join(process.cwd(),'outer/package.json')+'.'};
       const file='./outer/inner/value.js';
       assert.throws(()=>import.meta.resolve(file),expected);
       await assert.rejects(import(file),expected);
       assert.throws(()=>require(file),expected);
       const esm=await import('./outer/inner/entry.mjs');
       const cjs=require('./outer/inner/entry.cjs');
       await assert.rejects(esm.read(),expected);
       assert.throws(()=>cjs.read(),expected);
       console.log('ok');`,
    );
  });

  it.each([
    "{}",
    "\ufeff{}",
    '{"main":42}',
    '{"type":"unknown"}',
    '{"exports":true}',
    '{"exports":42}',
    '{"imports":42}',
    '{"main":"index.js","unknown":undefined}',
    '{"main":"index.js","unknown":{"value":tru}}',
    '{"main":"index.js","unknown":"\\q"}',
    "{}{}",
    '{"main":"index.js","unknown":foo/bar}',
    '{"main":"index.js","unknown":{/* skipped */ "value":tru}}',
    '{"main":"index.js","t\\u0079pe":null}',
  ])("accepts metadata Node ignores: %j", async contents => {
    await run(
      { "node_modules/pkg/package.json": contents, "node_modules/pkg/index.js": "module.exports = 42;" },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       const name = 'pkg';
       assert.equal((await import(name)).default, 42);
       assert.equal(createRequire(import.meta.url)(name), 42);
       console.log('ok');`,
    );
  });

  it.each(["import", "require"])(
    "validates exports only when selected by %s, including self references",
    async mode => {
      await run(
        {
          "pkg/package.json": '{"name":"pkg","exports":{"0":"./value.cjs","default":"./value.cjs"}}',
          "pkg/value.cjs": "module.exports = 42;",
          "pkg/entry.mjs": "export const read = () => import('pkg');",
          "pkg/entry.cjs": "exports.read = () => require('pkg');",
        },
        `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       import {pathToFileURL} from 'node:url';
       assert.equal((await import('./pkg/value.cjs')).default,42);
       const file = './pkg/entry.${mode === "import" ? "mjs" : "cjs"}';
       const entry = ${mode === "import" ? "await import(file)" : "createRequire(import.meta.url)(file)"};
       await assert.rejects(async () => entry.read(), {
         name:'Error', code:'ERR_INVALID_PACKAGE_CONFIG',
         message:'Invalid package config ' + join(process.cwd(),'pkg/package.json') + ' while importing ' + pathToFileURL(join(process.cwd(),file)).href + '. "exports" cannot contain numeric property keys.',
       });
       console.log('ok');`,
      );
    },
  );

  it.each(["0", "1.5", "1e-7", "0.000001", "4294967294.5"])(
    "rejects Node's canonical numeric conditions in exports and imports: %s",
    async key => {
      const target = { [key]: "./unused.cjs", default: "./value.cjs" };
      await run(
        { "package.json": JSON.stringify({ name: "pkg", exports: target, imports: { "#selected": target } }) },
        `import assert from 'node:assert/strict';
         import {createRequire} from 'node:module';
         import {join} from 'node:path';
         const require = createRequire(import.meta.url);
         const expected = {code:'ERR_INVALID_PACKAGE_CONFIG',message:'Invalid package config '+join(process.cwd(),'package.json')+' while importing '+import.meta.url+'. "exports" cannot contain numeric property keys.'};
         for(const name of ['pkg','#selected']) {
           await assert.rejects(import(name),expected);
           assert.throws(() => require(name),expected);
         }
         console.log('ok');`,
      );
    },
  );

  it.each(["01", "1.0", "1e+0", "-0", "-1", "4294967295", "Infinity", "NaN"])(
    "accepts numeric-looking conditions that Node ignores: %s",
    async key => {
      const target = { [key]: "./unused.cjs", default: "./value.cjs" };
      await run(
        {
          "package.json": JSON.stringify({ name: "pkg", exports: target, imports: { "#selected": target } }),
          "value.cjs": "module.exports=42;",
        },
        `import assert from 'node:assert/strict';
         import {createRequire} from 'node:module';
         const require = createRequire(import.meta.url);
         for(const name of ['pkg','#selected']) {
           assert.equal((await import(name)).default,42);
           assert.equal(require(name),42);
         }
         console.log('ok');`,
      );
    },
  );

  it("ignores invalid conditional targets until their condition is selected", async () => {
    await run(
      {
        "node_modules/pkg/package.json": '{"exports":{"unused":{"0":"./value.cjs"},"default":"./value.cjs"}}',
        "node_modules/pkg/value.cjs": "module.exports = 42;",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       const name = 'pkg';
       assert.equal((await import(name)).default,42);
       assert.equal(createRequire(import.meta.url)(name),42);
       console.log('ok');`,
    );
  });

  it("continues past invalid array targets and retains the final target error", async () => {
    await run(
      {
        "node_modules/pkg/package.json": '{"exports":["bad","./value.cjs"]}',
        "node_modules/pkg/value.cjs": "module.exports = 42;",
        "node_modules/invalid/package.json": '{"exports":["bad","worse"]}',
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       const require = createRequire(import.meta.url);
       const name = 'pkg';
       assert.equal((await import(name)).default,42);
       assert.equal(require(name),42);
       const invalid = 'invalid';
       const head = 'Invalid "exports" main target "worse" defined in the package config ' + join(process.cwd(),'node_modules/invalid/package.json');
       const tail = '; targets must start with "./"';
       await assert.rejects(import(invalid), {code:'ERR_INVALID_PACKAGE_TARGET', message:head+' imported from '+join(process.cwd(),'driver.mjs')+tail});
       assert.throws(() => require(invalid), {code:'ERR_INVALID_PACKAGE_TARGET',message:head+tail});
       console.log('ok');`,
    );
  });

  it("continues after a URL imports target in an array", async () => {
    await run(
      {
        "package.json": '{"imports":{"#selected":["https://example.invalid/value","./value.cjs"]}}',
        "value.cjs": "module.exports = 42;",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       const name = '#selected';
       assert.equal((await import(name)).default,42);
       assert.equal(createRequire(import.meta.url)(name),42);
       console.log('ok');`,
    );
  });

  it.each([42, false, 1e21, -0])("preserves the final primitive array target: %j", async target => {
    await run(
      { "node_modules/pkg/package.json": JSON.stringify({ exports: ["bad", target] }) },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       const name = 'pkg';
       const head = ${JSON.stringify(`Invalid "exports" main target ${JSON.stringify(String(target))} defined in the package config `)} + join(process.cwd(),'node_modules/pkg/package.json');
       const tail = '; targets must start with "./"';
       await assert.rejects(import(name), {code:'ERR_INVALID_PACKAGE_TARGET',message:head+' imported from '+join(process.cwd(),'driver.mjs')+tail});
       assert.throws(() => createRequire(import.meta.url)(name), {code:'ERR_INVALID_PACKAGE_TARGET',message:head+tail});
       console.log('ok');`,
    );
  });

  it("leaves numeric conditions accepted by the bundler", async () => {
    using dir = tempDir("package-config-bundle", {
      "package.json": "{}",
      "entry.js": "import value from 'pkg'; console.log(value);",
      "node_modules/pkg/package.json": '{"exports":{"0":"./unused.js","default":"./value.js"}}',
      "node_modules/pkg/value.js": "export default 42;",
    });
    const result = await Bun.build({ entrypoints: [path.join(String(dir), "entry.js")], target: "bun", throw: false });
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("keeps escaped package fields in the bundler's metadata view", async () => {
    using dir = tempDir("package-config-bundler-fields", {
      "package.json": "{}",
      "entry.js": "import value from 'pkg'; console.log(value);",
      "node_modules/pkg/package.json": '{"ma\\u0069n":"value.js"}',
      "node_modules/pkg/value.js": "export default 42;",
    });
    const result = await Bun.build({ entrypoints: [path.join(String(dir), "entry.js")], target: "bun", throw: false });
    expect(result.logs).toEqual([]);
    expect(result.success).toBe(true);
  });

  it.each([
    '{"main":"index.cjs","type":"module","type":"unknown"}',
    '{"main":"index.cjs","type":"module","type":"commonjs","type":""}',
    '{"main":"index.cjs","type":"unknown","type":"m\\u006fdule","type":"unknown"}',
  ])("accepts repeated recognized and ignored type strings: %s", async contents => {
    await run(
      {
        "node_modules/pkg/package.json": contents,
        "node_modules/pkg/index.cjs": "module.exports = 42;",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       const name='pkg';
       assert.equal((await import(name)).default,42);
       assert.equal(createRequire(import.meta.url)(name),42);
       console.log('ok');`,
    );
  });

  // POSIX mode bits do not deny reads to root and do not model Windows ACLs.
  it.skipIf(isWindows || process.getuid?.() === 0).each(["file", "directory"])(
    "uses Node 24.21's unreadable package policy (%s)",
    async target => {
      await run(
        {
          "node_modules/pkg/package.json": '{"main":"main.cjs"}',
          "node_modules/pkg/main.cjs": "module.exports = 'selected';",
          "node_modules/pkg/index.js": "module.exports = 'fallback';",
        },
        `import assert from 'node:assert/strict';
       import {chmodSync} from 'node:fs';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       const file = join(process.cwd(),'node_modules/pkg/package.json');
       const protectedPath = ${target === "file" ? "file" : "join(process.cwd(),'node_modules/pkg')"};
       chmodSync(protectedPath,0);
       try {
         const expected = {name:'Error',code:'ERR_INVALID_PACKAGE_CONFIG',message:'Cannot read package config ' + file + ': permission denied.'};
         const name = 'pkg';
         await assert.rejects(import(name),expected);
         assert.throws(() => createRequire(import.meta.url)(name),expected);
       } finally { chmodSync(protectedPath,0o700); }
       console.log('ok');`,
      );
    },
  );

  // POSIX search permission can allow file access while denying a directory listing.
  it.skipIf(isWindows || process.getuid?.() === 0).each(["unreadable", "malformed", "missing", "valid"])(
    "checks scopes without directory enumeration (%s)",
    async kind => {
      await run(
        {
          "scope/package.json": kind === "unreadable" || kind === "malformed" ? "{}" : "invalid JSON",
          "scope/locked/value.js": "",
          ...(kind === "missing" ? {} : { "scope/locked/package.json": kind === "malformed" ? "invalid JSON" : "{}" }),
        },
        `import assert from 'node:assert/strict';
         import {chmodSync} from 'node:fs';
         import {join} from 'node:path';
         const directory = join(process.cwd(),'scope/locked');
         const manifest = join(directory,'package.json');
         chmodSync(directory,0o111);
         try {
           if (${JSON.stringify(kind)} === 'unreadable') chmodSync(manifest,0);
           const selected = './scope/locked/value.js';
           if (${JSON.stringify(kind)} === 'valid') {
             assert.doesNotThrow(() => import.meta.resolve(selected));
           } else {
             const message = ${JSON.stringify(kind)} === 'unreadable'
               ? 'Cannot read package config '+manifest+': permission denied.'
               : 'Invalid package config '+(${JSON.stringify(kind)} === 'missing' ? join(process.cwd(),'scope/package.json') : manifest)+'.';
             assert.throws(() => import.meta.resolve(selected), {code:'ERR_INVALID_PACKAGE_CONFIG',message});
           }
         } finally {
           chmodSync(directory,0o700);
           if (${JSON.stringify(kind)} !== 'missing') chmodSync(manifest,0o600);
         }
         console.log('ok');`,
      );
    },
  );

  it.each([
    [
      '{"abcdefgh\ud83d\udc38ijkl":tru,"other":false}',
      'Unexpected token \',\', ..."\udc38ijkl":tru,"other":f"... is not valid JSON',
    ],
    ['{"x":tru}', 'Unexpected token \'}\', "{"x":tru}" is not valid JSON'],
    ['{"x":trux}', 'Unexpected token \'x\', "{"x":trux}" is not valid JSON'],
    ['{"x":truex}', "Expected ',' or '}' after property value in JSON at position 9 (line 1 column 10)"],
    ['{"x":undefined}', 'Unexpected token \'u\', "{"x":undefined}" is not valid JSON'],
    ['{"x":NaN}', 'Unexpected token \'N\', "{"x":NaN}" is not valid JSON'],
    ['{"x":Infinity}', 'Unexpected token \'I\', "{"x":Infinity}" is not valid JSON'],
    ['{"x":-Infinity}', "No number after minus sign in JSON at position 6 (line 1 column 7)"],
    ['{"x":01}', "Unexpected number in JSON at position 6 (line 1 column 7)"],
    ['{"x":.1}', 'Unexpected token \'.\', "{"x":.1}" is not valid JSON'],
    ['{"x":1.}', "Unterminated fractional number in JSON at position 7 (line 1 column 8)"],
    ['{"x":1e}', "Exponent part is missing a number in JSON at position 7 (line 1 column 8)"],
    ['{"x":1e+}', "Exponent part is missing a number in JSON at position 8 (line 1 column 9)"],
    ['{"x":"\\q"}', "Bad escaped character in JSON at position 7 (line 1 column 8)"],
    ['{"x":"\\u00xz"}', "Bad Unicode escape in JSON at position 10 (line 1 column 11)"],
    ['{"x":[true,]}', 'Unexpected token \']\', "{"x":[true,]}" is not valid JSON'],
    ['{"x":{"a":1,}}', "Expected double-quoted property name in JSON at position 12 (line 1 column 13)"],
    ['{"x":{a:1}}', "Expected property name or '}' in JSON at position 6 (line 1 column 7)"],
    ['{"x":{"a" 1}}', "Expected ':' after property name in JSON at position 10 (line 1 column 11)"],
    ['{"x":[1 2]}', "Expected ',' or ']' after array element in JSON at position 8 (line 1 column 9)"],
    ['{"x":[1,,2]}', 'Unexpected token \',\', "{"x":[1,,2]}" is not valid JSON'],
    ['{"x":{"a":}}', 'Unexpected token \'}\', "{"x":{"a":}}" is not valid JSON'],
    ['{"x":/*c*/null}', 'Unexpected token \'/\', "{"x":/*c*/null}" is not valid JSON'],
    ['{"x":null //c\n}', "Expected ',' or '}' after property value in JSON at position 10 (line 1 column 11)"],
    ['{"x":{"a":tru},"y":false}', 'Unexpected token \'}\', ..."":{"a":tru},"y":fals"... is not valid JSON'],
    [
      '{"\ud83d\udc38\ud83d\udc38\ud83d\udc38\ud83d\udc38\ud83d\udc38":tru}',
      'Unexpected token \'}\', "{"\ud83d\udc38\ud83d\udc38\ud83d\udc38\ud83d\udc38\ud83d\udc38":tru}" is not valid JSON',
    ],
    ['{"abcd\ud83d\udc38efghij":tru}', 'Unexpected token \'}\', "{"abcd\ud83d\udc38efghij":tru}" is not valid JSON'],
    [
      '{\r\n "\ud83d\udc38": [1 2]}',
      "Expected ',' or ']' after array element in JSON at position 13 (line 2 column 11)",
    ],
    ["[object Object]", '"[object Object]" is not valid JSON'],
    ["{", "Expected property name or '}' in JSON at position 1 (line 1 column 2)"],
    ["[1", "Expected ',' or ']' after array element in JSON at position 2 (line 1 column 3)"],
    ["[true 42]", "Expected ',' or ']' after array element in JSON at position 6 (line 1 column 7)"],
    ["[fals1]", "Unexpected number in JSON at position 5 (line 1 column 6)"],
    ['[tru"e"]', "Unexpected string in JSON at position 4 (line 1 column 5)"],
    ["[true] []", "Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)"],
  ])("materializes both package maps with Node JSON diagnostics: %j", async (value, message) => {
    for (const field of ["exports", "imports"]) {
      await run(
        {
          "node_modules/pkg/package.json": JSON.stringify({
            main: "value.cjs",
            exports: "./value.cjs",
            [field]: value,
          }),
          "node_modules/pkg/value.cjs": "module.exports=42;",
          "node_modules/pkg/value.js": "module.exports=42;",
        },
        `import assert from 'node:assert/strict';
         import {createRequire} from 'node:module';
         const require=createRequire(import.meta.url);
         assert.equal((await import('./node_modules/pkg/value.cjs')).default,42);
         assert.equal(require('./node_modules/pkg/value.js'),42);
         const check=error=>{assert.equal(error.name,'SyntaxError');assert.equal(error.code,undefined);assert.equal(error.message,${JSON.stringify(message)});return true;};
         const name='pkg';
         await assert.rejects(import(name),check);
         assert.throws(()=>require(name),check);
         console.log('ok');`,
      );
    }
  });

  it("materializes unused raw maps and gives exports JSON errors precedence", async () => {
    const messages = [
      ["pkg", 'Unexpected token \'}\', "{"x":tru}" is not valid JSON'],
      ["both", "Unexpected token ']', \"[tru]\" is not valid JSON"],
    ];
    await run(
      {
        "node_modules/pkg/package.json": '{"exports":"./value.cjs","imports":{"x":tru}}',
        "node_modules/pkg/value.cjs": "module.exports=42;",
        "node_modules/both/package.json": JSON.stringify({ imports: '{"x":tru}', exports: "[tru]" }),
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       const require=createRequire(import.meta.url);
       for(const [name,message] of ${JSON.stringify(messages)}) {
         await assert.rejects(import(name),{name:'SyntaxError',message});
         assert.throws(()=>require(name),{name:'SyntaxError',message});
       }
       console.log('ok');`,
    );
  });

  it("accepts JSON-encoded maps in string fields like Node", async () => {
    await run(
      {
        "package.json": JSON.stringify({
          name: "pkg",
          exports: JSON.stringify(["./value.cjs"]),
          imports: JSON.stringify({ "#value": "./value.cjs" }),
        }),
        "value.cjs": "module.exports=42;",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       const require=createRequire(import.meta.url);
       for(const name of ['pkg','#value']) {
         assert.equal((await import(name)).default,42);
         assert.equal(require(name),42);
       }
       console.log('ok');`,
    );
  });

  it.each(["\ud800", "\udfff", "\u000b", "\u2028", "\u2029", "\ufeff", "\\uD800"])(
    "uses JSON.stringify escaping in invalid target diagnostics: %j",
    async target => {
      await run(
        { "node_modules/pkg/package.json": JSON.stringify({ exports: [target] }) },
        `import assert from 'node:assert/strict';
         import {createRequire} from 'node:module';
         import {join} from 'node:path';
         const require=createRequire(import.meta.url);
         const name='pkg';
         const head=${JSON.stringify(`Invalid "exports" main target ${JSON.stringify(target)} defined in the package config `)}+join(process.cwd(),'node_modules/pkg/package.json');
         const tail='; targets must start with "./"';
         await assert.rejects(import(name),{code:'ERR_INVALID_PACKAGE_TARGET',message:head+' imported from '+join(process.cwd(),'driver.mjs')+tail});
         assert.throws(()=>require(name),{code:'ERR_INVALID_PACKAGE_TARGET',message:head+tail});
         console.log('ok');`,
      );
    },
  );

  it.each([
    {
      "label": "self-unused-imports",
      "metadata": { "name": "pkg", "exports": "./value.cjs", "imports": "[tru]" },
      "specifier": "pkg",
      "esm": "Unexpected token ']', \"[tru]\" is not valid JSON",
      "cjs": null,
    },
    {
      "label": "external-unused-imports",
      "metadata": { "name": "pkg", "exports": "./value.cjs", "imports": "[tru]" },
      "specifier": "external",
      "esm": "Unexpected token ']', \"[tru]\" is not valid JSON",
      "cjs": null,
    },
    {
      "label": "imports-both-invalid",
      "metadata": { "name": "pkg", "exports": "[tru]", "imports": '{"x":tru}' },
      "specifier": "#selected",
      "esm": "Unexpected token ']', \"[tru]\" is not valid JSON",
      "cjs": 'Unexpected token \'}\', "{"x":tru}" is not valid JSON',
    },
    {
      "label": "imports-valid-exports-invalid",
      "metadata": { "name": "pkg", "exports": "[tru]", "imports": { "#selected": "./value.cjs" } },
      "specifier": "#selected",
      "esm": "Unexpected token ']', \"[tru]\" is not valid JSON",
      "cjs": "Unexpected token ']', \"[tru]\" is not valid JSON",
    },
    {
      "label": "external-exports-invalid",
      "metadata": { "name": "pkg", "exports": "[tru]", "imports": '{"x":tru}' },
      "specifier": "external",
      "esm": "Unexpected token ']', \"[tru]\" is not valid JSON",
      "cjs": "Unexpected token ']', \"[tru]\" is not valid JSON",
    },
    {
      "label": "nameless-exports-invalid",
      "metadata": { "exports": "[tru]" },
      "specifier": "external",
      "esm": "Unexpected token ']', \"[tru]\" is not valid JSON",
      "cjs": "Unexpected token ']', \"[tru]\" is not valid JSON",
    },
    {
      "label": "imports-absent-exports-invalid",
      "metadata": { "name": "pkg", "exports": "[tru]" },
      "specifier": "#selected",
      "esm": "Unexpected token ']', \"[tru]\" is not valid JSON",
      "cjs": "Unexpected token ']', \"[tru]\" is not valid JSON",
    },
  ])("preserves CommonJS map getter ordering: $label", async ({ metadata, specifier, esm, cjs }) => {
    await run(
      {
        "package.json": JSON.stringify(metadata),
        "value.cjs": "module.exports=42;",
        "node_modules/external/package.json": '{"main":"index.cjs"}',
        "node_modules/external/index.cjs": "module.exports=42;",
      },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       const require=createRequire(import.meta.url);
       const name=${JSON.stringify(specifier)};
       await assert.rejects(import(name),{name:'SyntaxError',message:${JSON.stringify(esm)}});
       const message=${JSON.stringify(cjs)};
       if(message===null) {
         assert.equal(require(name),42);
         assert.equal(typeof require.resolve(name),'string');
       } else {
         assert.throws(()=>require(name),{name:'SyntaxError',message});
         assert.throws(()=>require.resolve(name),{name:'SyntaxError',message});
       }
       console.log('ok');`,
    );
  });

  it("retains CommonJS parents in missing-package diagnostics", async () => {
    await run(
      { "entry.cjs": "exports.read = () => require('missing-package');" },
      `import assert from 'node:assert/strict';
       import {createRequire} from 'node:module';
       import {join} from 'node:path';
       const require = createRequire(import.meta.url);
       const entry = require('./entry.cjs');
       const stack = [join(process.cwd(),'entry.cjs'), join(process.cwd(),'driver.mjs')];
       assert.throws(() => entry.read(), {
         code:'MODULE_NOT_FOUND', requireStack:stack,
         message:"Cannot find module 'missing-package'\\nRequire stack:\\n- " + stack.join('\\n- '),
       });
       console.log('ok');`,
    );
  });
});
