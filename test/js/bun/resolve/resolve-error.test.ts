import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, MAX_PATH_BYTES, tempDir } from "harness";
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

// The resolver builds every candidate path in a buffer of MAX_PATH_BYTES. A
// candidate that did not fit was written past the end of that buffer and
// aborted the process:
//   panic: range end index 4099 out of range for slice of length 4096
// Nothing could open such a candidate anyway, so it now resolves like a path
// that does not exist. What gets there: config text of any length (package.json
// "main" / "module" / "browser", tsconfig.json "extends" / "baseUrl" / "paths"),
// specifiers, and the contents of directories that themselves still fit.
describe.concurrent("candidate paths that do not fit a path buffer", () => {
  const deepDirectoryFixture = path.join(import.meta.dir, "fixtures", "deep-directory-fixture.cjs");
  // A relative value is joined onto a directory, so this never fits; an
  // absolute one replaces the directory and is over the limit by itself.
  const longName = Buffer.alloc(MAX_PATH_BYTES, "a").toString();

  /**
   * Runs main.cjs, which prints one JSON value, in a project. package.json and
   * node_modules/ keep the resolver from auto-installing the bare specifiers.
   */
  async function run(files: Record<string, string>) {
    using dir = tempDir("resolve-too-long", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      ...files,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let result: unknown = stdout;
    try {
      result = JSON.parse(stdout);
    } catch {}
    return { result, stderr, exitCode };
  }

  const helpers = `
    const outcome = fn => { try { return "resolved: " + fn(); } catch (e) { return e.code; } };
  `;

  it("package.json main and module fields", async () => {
    expect(
      await run({
        "node_modules/relative/package.json": JSON.stringify({ name: "relative", main: `./${longName}` }),
        "node_modules/absolute/package.json": JSON.stringify({ name: "absolute", module: `/${longName}` }),
        "main.cjs": `${helpers}
          import("absolute").then(() => "resolved", e => e.code).then(absolute => {
            console.log(JSON.stringify({ relative: outcome(() => require("relative")), absolute }));
          });`,
      }),
    ).toEqual({
      result: { relative: "MODULE_NOT_FOUND", absolute: "ERR_MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });

  it("a package name whose subpath normalizes away", async () => {
    // `<name>/../pkg` as a whole normalizes to node_modules/pkg and fits; only
    // the package directory probed for the name itself does not. Node resolves
    // this to pkg, and so does bun with a short name.
    const specifier = `${longName}/../pkg`;
    expect(
      await run({
        "node_modules/pkg/index.js": `module.exports = "pkg";`,
        "main.cjs": `${helpers}
          import(${JSON.stringify(specifier)}).then(m => "resolved: " + m.default, e => e.code).then(imported => {
            console.log(JSON.stringify({ required: outcome(() => require(${JSON.stringify(specifier)})), imported }));
          });`,
      }),
    ).toEqual({
      result: { required: "resolved: pkg", imported: "resolved: pkg" },
      stderr: "",
      exitCode: 0,
    });
  });

  it("package.json browser field remapping the main field", async () => {
    expect(
      await run({
        "node_modules/m/package.json": JSON.stringify({
          name: "m",
          main: "./x.js",
          browser: { "./x.js": `./${longName}` },
        }),
        "node_modules/m/x.js": "module.exports = 1;",
        "entry.js": `import "m";`,
        "main.cjs": `
          Bun.build({ entrypoints: ["./entry.js"], target: "browser", throw: false }).then(build => {
            console.log(JSON.stringify({ success: build.success, messages: build.logs.map(log => log.message) }));
          });`,
      }),
    ).toEqual({
      result: { success: false, messages: ['Could not resolve: "m". Maybe you need to "bun install"?'] },
      stderr: "",
      exitCode: 0,
    });
  });

  it("tsconfig.json extends, baseUrl and paths", async () => {
    // Each use.cjs is governed by the tsconfig.json next to it. The one with
    // the unusable "extends" still loads; the other two resolve a bare
    // specifier against the unusable base directory.
    expect(
      await run({
        "extends/tsconfig.json": JSON.stringify({ extends: `./${longName}` }),
        "extends/use.cjs": `module.exports = "loaded";`,
        "baseUrl/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: longName } }),
        "baseUrl/use.cjs": `module.exports = require("x");`,
        "paths/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { x: [longName] } } }),
        "paths/use.cjs": `module.exports = require("x");`,
        "main.cjs": `${helpers}
          console.log(JSON.stringify({
            extends: outcome(() => require("./extends/use.cjs")),
            baseUrl: outcome(() => require("./baseUrl/use.cjs")),
            paths: outcome(() => require("./paths/use.cjs")),
          }));`,
      }),
    ).toEqual({
      result: { extends: "resolved: loaded", baseUrl: "MODULE_NOT_FOUND", paths: "MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });

  // The lengths below are lengths of whole paths. Windows has no way to build
  // them: its buffers hold three times what NTFS accepts.
  describe.skipIf(isWindows)("paths within a few bytes of the limit", () => {
    const MAX = MAX_PATH_BYTES;
    const deepHelpers = `${helpers}
      const { makeDirectoryOfLength, writeFileIn, mkdirIn } = require(${JSON.stringify(deepDirectoryFixture)});
      const { symlinkSync, writeFileSync } = require("fs");
      const MAX = ${MAX};
      const cwd = process.cwd();
      const name = (length, fill) => Buffer.alloc(length, fill).toString();
    `;

    it("a missing file in an existing directory", async () => {
      // Five bytes under the limit is the longest path every extension probe
      // still fits behind; from there up, first the probes and then the path
      // itself are over.
      const lengths = [MAX - 5, MAX - 4, MAX - 1, MAX, MAX + 1, MAX + 300];
      expect(
        await run({
          "main.cjs": `${deepHelpers}
            const out = {};
            for (const length of ${JSON.stringify(lengths)}) {
              const file = cwd + "/" + name(length - cwd.length - 1, "f");
              out[length] = [outcome(() => require(file)), outcome(() => require.resolve(file))];
            }
            console.log(JSON.stringify(out));`,
        }),
      ).toEqual({
        result: Object.fromEntries(lengths.map(length => [length, ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]])),
        stderr: "",
        exitCode: 0,
      });
    });

    it("an existing directory", async () => {
      // The directory fits, so it is read; what is probed inside it does not.
      const lengths = [MAX - 3, MAX - 2, MAX - 1];
      expect(
        await run({
          "main.cjs": `${deepHelpers}
            const parent = makeDirectoryOfLength(cwd, MAX - 200);
            (async () => {
              const out = {};
              for (const length of ${JSON.stringify(lengths)}) {
                const dir = mkdirIn(parent, name(length - parent.length - 1, "e"));
                out[length] = [
                  outcome(() => require(dir)),
                  outcome(() => require.resolve(dir)),
                  outcome(() => Bun.resolveSync(dir, "/")),
                  await import(dir).then(() => "resolved", e => e.code),
                ];
              }
              console.log(JSON.stringify(out));
            })();`,
        }),
      ).toEqual({
        result: Object.fromEntries(
          lengths.map(length => [
            length,
            ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"],
          ]),
        ),
        stderr: "",
        exitCode: 0,
      });
    });

    it("files listed in an existing directory", async () => {
      // Such a file is left out of the directory listing, so it is not there
      // as far as the resolver is concerned: a package.json or tsconfig.json
      // in that position is ignored without a message, at runtime and in a
      // build alike.
      expect(
        await run({
          "1/.keep": "",
          "2/.keep": "",
          "3/.keep": "",
          "4/.keep": "",
          "main.cjs": `${deepHelpers}
            // "/index.js" is 9 bytes: the first index file ends one byte under the limit, the second one byte over.
            const indexFits = makeDirectoryOfLength(cwd + "/1", MAX - 10);
            writeFileIn(indexFits, "index.js", "module.exports = 'index that fits';");
            const indexTooLong = makeDirectoryOfLength(cwd + "/2", MAX - 8);
            writeFileIn(indexTooLong, "index.js", "module.exports = 'unreachable';");
            // "/package.json" is 13 bytes, so its "main" (which fits) is not applied.
            const packageJsonTooLong = makeDirectoryOfLength(cwd + "/3", MAX - 11);
            writeFileIn(packageJsonTooLong, "package.json", '{"name": "deep", "main": "./m.cjs"}');
            writeFileIn(packageJsonTooLong, "m.cjs", "module.exports = 'unreachable';");
            // "/tsconfig.json" is 14 bytes; "/m.cjs" next to it still fits.
            const tsconfigTooLong = makeDirectoryOfLength(cwd + "/4", MAX - 13);
            writeFileIn(tsconfigTooLong, "tsconfig.json", '{"compilerOptions": {"jsx": "react"}}');
            writeFileIn(tsconfigTooLong, "m.cjs", "module.exports = 'module next to the tsconfig';");
            const build = entry => Bun.build({ entrypoints: [entry], throw: false })
              .then(b => ({ success: b.success, messages: b.logs.map(log => log.message) }));
            Promise.all([build(packageJsonTooLong + "/m.cjs"), build(tsconfigTooLong + "/m.cjs")]).then(builds => {
              console.log(JSON.stringify({
                indexFits: outcome(() => require(indexFits)),
                indexTooLong: outcome(() => require(indexTooLong)),
                packageJsonTooLong: outcome(() => require(packageJsonTooLong)),
                tsconfigTooLong: outcome(() => require(tsconfigTooLong + "/m.cjs")),
                builds,
              }));
            });`,
        }),
      ).toEqual({
        result: {
          indexFits: "resolved: index that fits",
          indexTooLong: "MODULE_NOT_FOUND",
          packageJsonTooLong: "MODULE_NOT_FOUND",
          tsconfigTooLong: "resolved: module next to the tsconfig",
          builds: [
            { success: true, messages: [] },
            { success: true, messages: [] },
          ],
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // Behind a symlink, the spelling the resolver was given fits while the real
    // path it derives need not. The link replaces the first component of the
    // tree, so its target stays short (some filesystems cap symlink targets at
    // 1024 bytes) and the spelling is about 250 bytes shorter than the real
    // path; the resolver derives the real path of each directory below the
    // link from its parent's. The links go in a directory the resolver has not
    // listed yet when they are made, because it caches listings.
    const symlinkHelpers = `${deepHelpers}
      // Makes the tree for \`real\`, links cwd/links/<i> to its first component
      // and returns \`real\` spelled through the link.
      const linkFirstComponent = (root, real, i) => {
        const end = real.indexOf("/", root.length + 1);
        if (end < 0) throw new Error("the tree below " + root + " needs at least two components");
        symlinkSync(real.slice(0, end), cwd + "/links/" + i);
        return cwd + "/links/" + i + real.slice(end);
      };
      const resolvedTo = (spelling, real) => {
        try {
          const resolved = require.resolve(spelling);
          return resolved === spelling ? "the spelling" : resolved === real ? "the real path" : resolved;
        } catch (e) {
          return e.code;
        }
      };
    `;

    it("a file whose real path behind a symlink does not fit", async () => {
      // One byte over the limit and exactly at it resolve to the spelling;
      // one byte under it is recorded as the real path as usual.
      const files = [
        ["MAX + 1", 1],
        ["MAX", 0],
        ["MAX - 1", -1],
      ] as const;
      expect(
        await run({
          "0/.keep": "",
          "1/.keep": "",
          "2/.keep": "",
          "links/.keep": "",
          "main.cjs": `${symlinkHelpers}
            const trees = ${JSON.stringify(files)}.map(([label, over], i) => {
              // "/x.js" is 5 bytes.
              const real = makeDirectoryOfLength(cwd + "/" + i, MAX - 5 + over);
              writeFileIn(real, "x.js", "");
              return [label, real + "/x.js", linkFirstComponent(cwd + "/" + i, real, i) + "/x.js"];
            });
            const out = {};
            for (const [label, real, spelling] of trees) out[label] = resolvedTo(spelling, real);
            console.log(JSON.stringify(out));`,
        }),
      ).toEqual({
        result: { "MAX + 1": "the spelling", "MAX": "the spelling", "MAX - 1": "the real path" },
        stderr: "",
        exitCode: 0,
      });
    });

    // macOS applies the limit to the path after symlink expansion, so such a
    // directory cannot be entered there at all.
    it.skipIf(isMacOS)("a directory whose real path behind a symlink does not fit", async () => {
      expect(
        await run({
          "0/.keep": "",
          "links/.keep": "",
          "main.cjs": `${symlinkHelpers}
            const parent = makeDirectoryOfLength(cwd + "/0", MAX - 60);
            mkdirIn(parent, name(100, "s"));
            const spelling = linkFirstComponent(cwd + "/0", parent, 0) + "/" + name(100, "s");
            writeFileSync(spelling + "/index.js", "");
            console.log(JSON.stringify(outcome(() => {
              const resolved = require.resolve(spelling);
              return resolved === spelling + "/index.js" ? "the index file, spelled through the link" : resolved;
            })));`,
        }),
      ).toEqual({
        result: "resolved: the index file, spelled through the link",
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
