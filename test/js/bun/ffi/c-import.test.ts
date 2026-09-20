import { describe, expect, test } from "bun:test";
import { chmodSync, symlinkSync, truncateSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isPosix, isWindows, tempDir } from "harness";
import { basename, join } from "path";
import { cEnv as env, lines, repeated, supported } from "./bir/run-fixtures";

// `import … from "./x.c"` compiles the file with Bun's own C compiler (bun_cc + JavaScriptCore's B3).
// C's stdout is in text mode on Windows: "\r\n" there.
const text = async (stream: ReadableStream<Uint8Array>) => lines(await stream.text());
// What `bun build --compile --outfile name` makes.
const executable = (name: string) => (isWindows ? name + ".exe" : name);

async function spawned(cmd: string[], cwd: string, extra: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd,
    env: { ...env, ...extra },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([text(proc.stdout), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}
const run = (dir: string, args: string[], extra: Record<string, string | undefined> = {}) =>
  spawned([bunExe(), ...args], dir, extra);

/** Waits for `text` to have appeared on `stream`, in the order it is asked for. */
function follow(stream: ReadableStream<Uint8Array>) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let seen = "";
  return async (text: string) => {
    while (!seen.includes(text)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended before ${JSON.stringify(text)}; saw ${JSON.stringify(seen)}`);
      seen += value.replaceAll("\r\n", "\n");
    }
    seen = seen.slice(seen.indexOf(text) + text.length);
  };
}

const mathC = /* c */ `
  typedef struct { double x, y; } Vec2;
  static Vec2 add2(Vec2 a, Vec2 b) { return (Vec2){ a.x + b.x, a.y + b.y }; }

  int add(int a, int b) { return a + b; }
  unsigned mix(unsigned x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
  double length2(double x, double y) { Vec2 v = add2((Vec2){ x, 0 }, (Vec2){ 0, y }); return v.x * v.x + v.y * v.y; }
  long long sum_bytes(const unsigned char *p, long long n) { long long t = 0; for (long long i = 0; i < n; i++) t += p[i]; return t; }
  static int hidden(void) { return 1; }
  int uses_hidden(void) { return hidden() + 41; }
`;

// What `bun build --target=bun` makes of `int add(int a, int b) { return a + b; }` on Linux x64 (glibc): the
// asset a bundle built there loads in the file's place.
const addCompiledForLinuxX64 = Buffer.from(
  "424952300000080001010100020001000100000100000000000100000103616464000102010100010647000047010146004601100203630401036164640005020505000000",
  "hex",
);

// Where compiled C does not run yet, saying so is all that importing a `.c` file does; asking for the file
// itself is what it always was.
describe.skipIf(supported)("where C is not supported", () => {
  const files = {
    "add.c": "int add(int a, int b) { return a + b; }\n",
    "compiles.ts": `import { add } from "./add.c"; console.log(add(1, 2));`,
  };

  // A bundle built where C is supported and run here: also on a machine whose processor and system the asset
  // is for but whose C library is another (Alpine).
  test.each([
    ["required.cjs", `console.log(require("./add-wxjnj05q.c").add(1, 2));`],
    ["attribute.cjs", `console.log(require("./add-wxjnj05q.c", { type: "c" }).add(1, 2));`],
    ["imported.mjs", `import { add } from "./add-wxjnj05q.c"; console.log(add(1, 2));`],
    ["dynamic.mjs", `const { add } = await import("./add-wxjnj05q.c"); console.log(add(1, 2));`],
  ])("%s: loading what bun build made of C elsewhere is the same error", async (entry, source) => {
    using dir = tempDir("c-import-unsupported", { "add-wxjnj05q.c": addCompiledForLinuxX64, [entry]: source });
    const { stdout, stderr, exitCode } = await run(String(dir), [entry]);
    expect(stderr).toContain("compiling C is not supported on this platform yet");
    expect(stderr).toContain("Linux x64 (glibc), macOS arm64 and Windows x64");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("the compiled form asked for as a file is the file", async () => {
    using dir = tempDir("c-import-unsupported", {
      "add-wxjnj05q.c": addCompiledForLinuxX64,
      "file.ts": `import path from "./add-wxjnj05q.c" with { type: "file" }; console.log((await Bun.file(path).bytes()).length);`,
    });
    const { stdout, exitCode } = await run(String(dir), ["file.ts"]);
    expect(stdout).toBe(`${addCompiledForLinuxX64.length}\n`);
    expect(exitCode).toBe(0);
  });

  test("importing it is an error that names the platforms", async () => {
    using dir = tempDir("c-import-unsupported", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["compiles.ts"]);
    expect(stderr).toContain("compiling C is not supported on this platform yet");
    expect(stderr).toContain("Linux x64 (glibc), macOS arm64 and Windows x64");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("so is building it", async () => {
    using dir = tempDir("c-import-unsupported", files);
    const { stderr, exitCode } = await run(String(dir), ["build", "--target", "bun", "compiles.ts", "--outdir", "out"]);
    expect(stderr).toContain("Compiling C is not supported on this platform yet");
    expect(exitCode).toBe(1);
  });

  test("and running it", async () => {
    using dir = tempDir("c-import-unsupported", { "main.c": "int main(void) { return 0; }\n" });
    const { stderr, exitCode } = await run(String(dir), ["main.c"]);
    expect(stderr).toContain("compiling C is not supported on this platform yet");
    expect(exitCode).toBe(1);
  });
});

// On every platform: a `.c` file is compiled only when it is imported as C. Asked for as a file or as text, or with
// the `.c` extension given back to the file loader, it is what it was before C files were modules, and is not
// compiled: this one is not C.
describe("a .c file asked for as a file", () => {
  const notes = "this is not C {\n";
  const files = {
    "notes.c": notes,
    "file.ts": `import path from "./notes.c" with { type: "file" }; console.log(typeof path, (await Bun.file(path).text()).length);`,
    "text.ts": `import source from "./notes.c" with { type: "text" }; console.log(typeof source, source.length);`,
    "dynamic.ts": `const { default: path } = await import("./notes.c", { with: { type: "file" } }); console.log(typeof path, (await Bun.file(path).text()).length);`,
    "plain.ts": `import path from "./notes.c"; console.log(typeof path, (await Bun.file(path).text()).length);`,
    "required.cjs": `const path = require("./notes.c"); console.log(typeof path, require("fs").readFileSync(path, "utf8").length);`,
  };
  const expected = `string ${notes.length}\n`;

  test.concurrent.each(["file.ts", "text.ts", "dynamic.ts"])("%s: an import attribute says so", async entry => {
    using dir = tempDir("c-import-as-file", files);
    const { stdout, stderr, exitCode } = await run(String(dir), [entry]);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--no-ffi-cc does not stand in the way of the file", async () => {
    using dir = tempDir("c-import-as-file", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--no-ffi-cc", "file.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(["plain.ts", "required.cjs"])("%s: --loader .c:file says so for every import", async entry => {
    using dir = tempDir("c-import-as-file", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--loader", ".c:file", entry]);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bunfig.toml's [loader] says so for every import", async () => {
    using dir = tempDir("c-import-as-file", { ...files, "bunfig.toml": `[loader]\n".c" = "file"\n` });
    const { stdout, stderr, exitCode } = await run(String(dir), ["plain.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun build --loader .c:file copies it, and as many entry points make as many outputs", async () => {
    using dir = tempDir("c-import-as-file", { ...files, "other.c": "neither is this\n" });
    const build = await run(String(dir), [
      "build",
      "plain.ts",
      "notes.c",
      "other.c",
      "--loader",
      ".c:file",
      "--target=bun",
      "--outdir",
      "out",
    ]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    const out = join(String(dir), "out");
    const made = [...new Bun.Glob("*").scanSync(out)].sort();
    expect(made.map(name => name.replace(/-[a-z0-9]{8}\./, "-HASH."))).toEqual([
      "notes-HASH.c",
      "notes.js",
      "other-HASH.c",
      "other.js",
      "plain.js",
    ]);
    expect(await Bun.file(join(out, made[0])).text()).toBe(notes);
    const { stdout, exitCode } = await run(out, ["plain.js"]);
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("Bun.build({ loader: { '.c': 'file' } }) copies it", async () => {
    using dir = tempDir("c-import-as-file", {
      ...files,
      "build.ts": `
        const result = await Bun.build({ entrypoints: ["./plain.ts"], target: "bun", outdir: "out", loader: { ".c": "file" } });
        console.log(result.success, result.outputs.map(output => output.kind).sort().join());
      `,
    });
    const build = await run(String(dir), ["build.ts"]);
    expect(build.stderr).toBe("");
    expect(build.stdout).toBe("true asset,entry-point\n");
    const { stdout, exitCode } = await run(join(String(dir), "out"), ["plain.js"]);
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a URL in HTML or CSS names the file", async () => {
    using dir = tempDir("c-import-url", {
      "notes.c": notes,
      "page.html": `<!doctype html><link rel="stylesheet" href="./page.css"><link rel="preload" href="./notes.c" as="fetch"><img src="./notes.c">`,
      "page.css": `a { background: url("./notes.c"); }`,
    });
    const build = await run(String(dir), ["build", "page.html", "--outdir", "out"]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    const out = join(String(dir), "out");
    // A file this small goes into the style sheet itself.
    const [css] = [...new Bun.Glob("page-*.css").scanSync(out)];
    expect(await Bun.file(join(out, css)).text()).toContain(`url("data:text/x-c;base64,${btoa(notes)}")`);
  });
});

describe.skipIf(!supported)("importing a .c file", () => {
  test.concurrent("named, default, dynamic and require all see the file's non-static functions", async () => {
    using dir = tempDir("c-import", {
      "math.c": mathC,
      "index.ts": `
        import math, { add, mix, length2, sum_bytes, uses_hidden } from "./math.c";
        const dynamic = await import("./math.c");
        const required = require("./math.c");
        console.log(JSON.stringify({
          add: add(40, 2),
          mix: mix(12345),
          length2: length2(3, 4),
          sum_bytes: String(sum_bytes(new Uint8Array([1, 2, 3, 250]), 4n)),
          uses_hidden: uses_hidden(),
          keys: Object.keys(dynamic).sort(),
          same: dynamic.add === add && required.add === add && math.add === add,
          hiddenIsPrivate: !("hidden" in dynamic) && !("add2" in dynamic),
        }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      add: 42,
      mix: 2435775735,
      length2: 25,
      sum_bytes: "256",
      uses_hidden: 42,
      keys: ["add", "default", "length2", "mix", "sum_bytes", "uses_hidden"],
      same: true,
      hiddenIsPrivate: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("the calls reach the optimizing JIT and stay correct there", async () => {
    using dir = tempDir("c-import-hot", {
      "math.c": mathC,
      "index.ts": `
        import { add, mix } from "./math.c";
        const mixJS = (x: number) => { x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; };
        let t = 0, u = 0, v = 0;
        for (let i = 0; i < 3_000_000; i++) { t = add(t, i) | 0; u ^= mix(i); v ^= mixJS(i); }
        console.log(t, u === v);
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
    let expected = 0;
    for (let i = 0; i < 3_000_000; i++) expected = (expected + i) | 0;
    expect(stdout.trim()).toBe(`${expected} true`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a compile error is a BuildMessage with the file, the line and the column", async () => {
    using dir = tempDir("c-import-error", {
      "broken.c": "int f(void) {\n  return undeclared_thing + 1;\n}\n",
      "index.ts": `
        try { await import("./broken.c"); console.log("no error"); }
        catch (e) {
          const { name, message, level, position } = e as BuildMessage;
          console.log(JSON.stringify({ name, message, level, ...position, file: require("node:path").basename(position!.file) }));
        }
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
    expect(JSON.parse(stdout)).toEqual({
      name: "BuildMessage",
      message: "use of undeclared identifier 'undeclared_thing'",
      level: "error",
      lineText: "  return undeclared_thing + 1;",
      file: "broken.c",
      namespace: "file",
      line: 2,
      column: 10,
      length: "undeclared_thing".length,
      offset: 23,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "a function the process does not have is an error at import that names the file, not a crash at call",
    async () => {
      using dir = tempDir("c-import-undefined", {
        "needs.c":
          "int bun_test_symbol_that_does_not_exist(int);\nint f(int x) { return bun_test_symbol_that_does_not_exist(x); }\n",
        "index.ts": `
        try { await import("./needs.c"); console.log("no error"); }
        catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
      `,
      });
      const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
      expect(stdout.trim()).toBe("TypeError: needs.c: undefined symbol 'bun_test_symbol_that_does_not_exist'");
      expect(exitCode).toBe(0);
    },
  );

  // Root reads what it has no permission for; Windows has no such permission bits.
  test.concurrent.skipIf(!isPosix || process.getuid?.() === 0)(
    "a file that cannot be read is the system's error, with its code and the path",
    async () => {
      using dir = tempDir("c-import-unreadable", {
        "secret.c": "int f(void) { return 1; }\n",
        "index.ts": `
          try { await import("./secret.c"); console.log("no error"); }
          catch (e) { const { code, syscall, path } = e as any; console.log(code, syscall, require("node:path").basename(path)); }
        `,
      });
      chmodSync(join(String(dir), "secret.c"), 0o000);
      const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
      expect(stdout).toBe("EACCES open secret.c\n");
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("C_INCLUDE_PATH adds directories for #include <…>, as it does for gcc, clang and cc()", async () => {
    using dir = tempDir("c-import-include-path", {
      "third_party/include/lib/version.h": "#define LIB_VERSION 7\n",
      "src/use.c": "#include <lib/version.h>\nint version(void) { return LIB_VERSION; }\n",
      "src/index.ts": `import { version } from "./use.c"; console.log(version());`,
    });
    const { stdout, stderr, exitCode } = await run(join(String(dir), "src"), ["index.ts"], {
      C_INCLUDE_PATH: join(String(dir), "third_party/include"),
    });
    expect(stderr).toBe("");
    expect(stdout).toBe("7\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--no-ffi-cc turns it off, like bun:ffi's cc()", async () => {
    using dir = tempDir("c-import-disabled", {
      "math.c": mathC,
      "index.ts": `
        try { await import("./math.c"); console.log("no error"); }
        catch (e) { console.log((e as any).code, "|", String((e as Error).message)); }
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["--no-ffi-cc", "index.ts"]);
    expect(stdout.trim()).toBe(
      "ERR_FFI_CC_DISABLED | Cannot import C code because the bun:ffi C compiler is disabled.",
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("#include finds files next to the source and the compiler's own headers", async () => {
    using dir = tempDir("c-import-include", {
      "limits.h": "#define LOCAL_LIMIT 7\n",
      "shape.h":
        '#pragma once\n#include <stdint.h>\n#include <stdbool.h>\n#include "limits.h"\ntypedef struct { int32_t w, h; } Size;\n',
      "shape.c":
        '#include "shape.h"\n#include <stddef.h>\nint area(int w, int h) { Size s = { w, h }; bool big = s.w * s.h > LOCAL_LIMIT; return big ? s.w * s.h : (int)offsetof(Size, h); }\n',
      "index.ts": `import { area } from "./shape.c"; console.log(area(3, 4), area(1, 2));`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("12 4");
    expect(exitCode).toBe(0);
  });

  // Whatever its case, an extension that is a loader's name is that loader's: `.C` as `.JSON` and `.Toml` are.
  test.concurrent("a file named .C is C", async () => {
    using dir = tempDir("c-import-upper", {
      "Upper.C": "int add(int a, int b) { return a + b; }\n",
      "index.ts": `import { add } from "./Upper.C"; console.log(add(1, 2));`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("3\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("any file is C when the import says so: an attribute, or --loader for its extension", async () => {
    using dir = tempDir("c-import-typed", {
      "add.txt": "int add(int a, int b) { return a + b; }\n",
      "add.x": "int add(int a, int b) { return a + b + 100; }\n",
      "attribute.ts": `import { add } from "./add.txt" with { type: "c" }; console.log(add(5, 6));`,
      "extension.ts": `import { add } from "./add.x"; console.log(add(5, 6));`,
    });
    const attribute = await run(String(dir), ["attribute.ts"]);
    expect(attribute.stderr).toBe("");
    expect(attribute.stdout).toBe("11\n");
    const extension = await run(String(dir), ["--loader", ".x:c", "extension.ts"]);
    expect(extension.stderr).toBe("");
    expect(extension.stdout).toBe("111\n");
  });

  test.concurrent("a plugin's onLoad may answer with C", async () => {
    using dir = tempDir("c-import-plugin", {
      "plugin.ts": `
        Bun.plugin({
          name: "c",
          setup(build) {
            build.onLoad({ filter: /\\.generated$/ }, () => ({ contents: "int answer(void) { return 42; }", loader: "c" }));
          },
        });
      `,
      "math.generated": "",
      "index.ts": `import { answer } from "./math.generated"; console.log(answer());`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--preload", "./plugin.ts", "index.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("42\n");
    expect(exitCode).toBe(0);
  });

  // perf(1) reads /tmp/perf-<pid>.map for the names of code made at run time.
  test.concurrent.skipIf(!isLinux)("BUN_JSC_writeCModulePerfMap names each C function for perf", async () => {
    using dir = tempDir("c-import-perf-map", {
      "math.c": mathC,
      "index.ts": `import { add } from "./math.c"; console.log(process.pid, add(1, 2));`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.ts"], { BUN_JSC_writeCModulePerfMap: "1" });
    expect(stderr).toBe("");
    const [pid, sum] = stdout.trim().split(" ");
    expect(sum).toBe("3");
    const map = Bun.file(`/tmp/perf-${pid}.map`);
    const symbols = await map.text();
    await map.delete();
    for (const name of ["add", "mix", "length2", "sum_bytes", "uses_hidden", "hidden", "add2"])
      expect(symbols).toMatch(new RegExp(`^[0-9a-f]+ [0-9a-f]+ C:${name}$`, "m"));
    expect(exitCode).toBe(0);
  });

  // Said of the file's size: a file of zeros that takes no room on the disk is not read to be refused.
  test.concurrent(
    "a C file of more than a gibibyte is refused without being read, however it is asked for",
    async () => {
      using dir = tempDir("c-import-too-large", {
        "big.c": "",
        "imported.mjs": `try { await import("./big.c"); } catch (e) { console.log(e.name, e.message); }`,
        "required.cjs": `try { require("./big.c"); } catch (e) { console.log(e.name, e.message); }`,
        "entry.ts": `import "./big.c";`,
      });
      const big = join(String(dir), "big.c");
      truncateSync(big, 2 ** 30 + 1);
      const refused = `'${big}' cannot be read: larger than 1073741824 bytes`;
      for (const entry of ["imported.mjs", "required.cjs"]) {
        const { stdout, stderr, exitCode } = await run(String(dir), [entry]);
        expect(stderr).toBe("");
        expect(stdout).toBe(`BuildMessage ${refused}\n`);
        expect(exitCode).toBe(0);
      }
      const program = await run(String(dir), ["big.c"]);
      expect(program.stderr).toContain(`error: ${refused}`);
      expect(program.exitCode).toBe(1);
      const build = await run(String(dir), ["build", "entry.ts", "--target=bun", "--outdir", "out"]);
      expect(build.stderr).toContain(`error: ${refused}`);
      expect(build.exitCode).toBe(1);
    },
  );

  test.concurrent("bun test imports C too", async () => {
    using dir = tempDir("c-import-bun-test", {
      "math.c": mathC,
      "math.test.ts": `
        import { expect, test } from "bun:test";
        import { add } from "./math.c";
        test("add", () => expect(add(2, 3)).toBe(5));
      `,
    });
    const { stderr, exitCode } = await run(String(dir), ["test", "math.test.ts"]);
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });
});

// An import that can wait (a static or dynamic `import`) has its C compiled on the thread pool that transpiles
// JavaScript for such imports, and the module is made of the result back on the JavaScript thread; `require()`,
// which cannot wait, compiles where it is. Either way it is the same module or the same error.
describe.skipIf(!supported)("a .c file is compiled where JavaScript would be transpiled", () => {
  const broken = '#include "broken.h"\nint f(void) {\n  return undeclared_thing + 1;\n}\n';
  // How the three ways of importing report what went wrong.
  const report = `
    function report(e) {
      const { name, message, level, position, code, syscall, path } = e;
      const where = position && { ...position, file: require("node:path").basename(position.file) };
      return JSON.stringify({ name, message, level, where, code, syscall, path: path && require("node:path").basename(path) });
    }
  `;
  const ways = {
    "static.mjs": `${report} try { await import("./static-importer.mjs"); console.log("no error"); } catch (e) { console.log(report(e)); }`,
    "static-importer.mjs": `import { f } from "./subject.c"; console.log(f());`,
    "dynamic.mjs": `${report} try { await import("./subject.c"); console.log("no error"); } catch (e) { console.log(report(e)); }`,
    "required.cjs": `${report} try { require("./subject.c"); console.log("no error"); } catch (e) { console.log(report(e)); }`,
  };

  test.concurrent("a compile error is the same BuildMessage from a static import, import() and require()", async () => {
    using dir = tempDir("c-import-paths", { ...ways, "subject.c": broken, "broken.h": "#define OK 1\n" });
    const seen = new Set<string>();
    for (const entry of ["static.mjs", "dynamic.mjs", "required.cjs"]) {
      const { stdout, stderr, exitCode } = await run(String(dir), [entry]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        name: "BuildMessage",
        message: "use of undeclared identifier 'undeclared_thing'",
        level: "error",
        where: {
          lineText: "  return undeclared_thing + 1;",
          file: "subject.c",
          namespace: "file",
          line: 3,
          column: 10,
          length: "undeclared_thing".length,
          offset: 43,
        },
      });
      expect(exitCode).toBe(0);
      seen.add(stdout);
    }
    expect(seen.size).toBe(1);
  });

  test.concurrent("an error in a header says where the header was included from, from every way in", async () => {
    using dir = tempDir("c-import-paths", {
      ...ways,
      "subject.c": '#include "broken.h"\nint f(void) { return 1; }\n',
      "broken.h": "int g(void) { return }\n",
      "uncaught.mjs": `import { f } from "./subject.c"; console.log(f());`,
    });
    const seen = new Set<string>();
    for (const entry of ["static.mjs", "dynamic.mjs", "required.cjs"]) {
      const { stdout, exitCode } = await run(String(dir), [entry]);
      const { name, where } = JSON.parse(stdout);
      expect({ name, file: where.file, line: where.line }).toEqual({ name: "BuildMessage", file: "broken.h", line: 1 });
      expect(exitCode).toBe(0);
      seen.add(stdout);
    }
    expect(seen.size).toBe(1);
    // Uncaught, it is printed with its code frame and the note.
    const { stderr, exitCode } = await run(String(dir), ["uncaught.mjs"]);
    expect(stderr).toContain("int g(void) { return }");
    expect(stderr).toContain("broken.h:1:");
    expect(stderr).toContain("subject.c:1:");
    expect(exitCode).toBe(1);
  });

  // Root reads what it has no permission for; Windows has no such permission bits.
  test.concurrent.skipIf(!isPosix || process.getuid?.() === 0)(
    "a file that cannot be read is the system's error, with its code and the path, from every way in",
    async () => {
      using dir = tempDir("c-import-paths", { ...ways, "subject.c": "int f(void) { return 1; }\n" });
      chmodSync(join(String(dir), "subject.c"), 0o000);
      for (const entry of ["static.mjs", "dynamic.mjs", "required.cjs"]) {
        const { stdout, exitCode } = await run(String(dir), [entry]);
        const { code, syscall, path } = JSON.parse(stdout);
        expect({ code, syscall, path }).toEqual({ code: "EACCES", syscall: "open", path: "subject.c" });
        expect(exitCode).toBe(0);
      }
    },
  );

  test.concurrent("a function the process does not have is the same error from every way in", async () => {
    using dir = tempDir("c-import-paths", {
      ...ways,
      "subject.c":
        "int bun_test_symbol_that_does_not_exist(int);\nint f(void) { return bun_test_symbol_that_does_not_exist(1); }\n",
    });
    for (const entry of ["static.mjs", "dynamic.mjs", "required.cjs"]) {
      const { stdout, exitCode } = await run(String(dir), [entry]);
      const { name, message } = JSON.parse(stdout);
      expect({ name, message }).toEqual({
        name: "TypeError",
        message: "subject.c: undefined symbol 'bun_test_symbol_that_does_not_exist'",
      });
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("top-level await waits for the module, and the modules evaluate in order", async () => {
    using dir = tempDir("c-import-await", {
      "math.c": mathC,
      "awaited.mjs": `export const { add } = await import("./math.c"); export const order = ["awaited"];`,
      "index.mjs": `
        import { add as early, order } from "./awaited.mjs";
        import { add } from "./math.c";
        const other = await import("./other.c");
        console.log(early === add, add(1, 2), other.triple(3), order.join());
      `,
      "other.c": "int triple(int x) { return x * 3; }\n",
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.mjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true 3 9 awaited\n");
    expect(exitCode).toBe(0);
  });

  // On every platform: were the file compiled on the JavaScript thread, nothing else could run there meanwhile.
  test.concurrent("the JavaScript thread goes on while an import()'s C is compiled", async () => {
    using dir = tempDir("c-import-meanwhile", {
      // Long enough to compile that the event loop turns thousands of times meanwhile.
      "slow.c":
        Array.from({ length: 1500 }, (_, i) => `static int f${i}(int x) { return x * ${i} + 1; }`).join("\n") +
        "\nint sum(int x) { int total = 0;\n" +
        Array.from({ length: 1500 }, (_, i) => `total += f${i}(x);`).join("\n") +
        "\nreturn total; }\n",
      "index.mjs": `
        let turns = 0, imported = false;
        const turn = () => { if (!imported) { turns++; setImmediate(turn); } };
        setImmediate(turn);
        const { sum } = await import("./slow.c").finally(() => { imported = true; });
        console.log(JSON.stringify({ sum: sum(1), turns }));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.mjs"]);
    expect(stderr).toBe("");
    const { sum, turns } = JSON.parse(stdout);
    expect(sum).toBe((1499 * 1500) / 2 + 1500);
    // On the JavaScript thread it would be none, or the one turn before the file is looked at.
    expect(turns).toBeGreaterThan(5);
    expect(exitCode).toBe(0);
  });

  // On Linux a file can include the name of the thread that reads it: what is there is not C, so the error quotes it.
  // Where the C of an import is compiled has this one witness, and it is Linux's.
  test.concurrent.skipIf(!isLinux)(
    "import and import() compile on the pool's threads, several at once; require() compiles on its own",
    async () => {
      // Work for the thread to do first, so that the pool has its others take the rest.
      const work = Array.from({ length: 2000 }, (_, i) => `static int f${i}(int x) { return x * ${i}; }`).join("\n");
      const files: Record<string, string> = {
        "where.c": '#include "/proc/thread-self/comm"\n',
        "static-importer.mjs": `import "./where.c";`,
        "index.mjs": `
          const thread = e => e.position.lineText;
          const threads = { pool: [] };
          try { await import("./static-importer.mjs"); } catch (e) { threads.static = thread(e); }
          try { await import("./where.c"); } catch (e) { threads.dynamic = thread(e); }
          try { require("./where.c"); } catch (e) { threads.required = thread(e); }
          for (const result of await Promise.allSettled(Array.from({ length: 8 }, (_, i) => import("./part" + i + ".c")))) threads.pool.push(thread(result.reason));
          console.log(JSON.stringify(threads));
        `,
      };
      for (let i = 0; i < 8; i++) files[`part${i}.c`] = `${work}\n#include "/proc/thread-self/comm"\n`;
      using dir = tempDir("c-import-threads", files);
      const { stdout, stderr, exitCode } = await run(String(dir), ["index.mjs"]);
      expect(stderr).toBe("");
      const threads = JSON.parse(stdout);
      const pool = /^Bun Pool \d+$/;
      expect(threads.static).toMatch(pool);
      expect(threads.dynamic).toMatch(pool);
      expect(threads.required).not.toMatch(pool);
      for (const thread of threads.pool) expect(thread).toMatch(pool);
      expect(new Set(threads.pool).size).toBeGreaterThan(1);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("eight files that take a while to compile, imported together", async () => {
    // A few thousand functions each: long enough that they overlap on the pool, which has a thread for each.
    const body = (file: number) =>
      Array.from({ length: 3000 }, (_, i) => `static int f${i}(int x) { return x * ${i} + ${file}; }`).join("\n") +
      `\nint sum${file}(int x) { int total = 0;\n` +
      Array.from({ length: 3000 }, (_, i) => `total += f${i}(x);`).join("\n") +
      `\nreturn total; }\n`;
    const files: Record<string, string> = {};
    for (let file = 0; file < 8; file++) files[`part${file}.c`] = body(file);
    files["index.mjs"] =
      Array.from({ length: 8 }, (_, file) => `import { sum${file} } from "./part${file}.c";`).join("\n") +
      `\nconsole.log([${Array.from({ length: 8 }, (_, file) => `sum${file}(2)`).join()}].join());`;
    using dir = tempDir("c-import-parallel", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.mjs"]);
    expect(stderr).toBe("");
    const base = (2 * 2999 * 3000) / 2;
    expect(stdout).toBe(Array.from({ length: 8 }, (_, file) => base + 3000 * file).join() + "\n");
    expect(exitCode).toBe(0);
  });

  // The bytes the "where C is not supported" tests load are what this build makes; where they are for, they load.
  test.concurrent(
    "what bun build made of a C file for Linux x64 loads there, and is for a different target anywhere else",
    async () => {
      using dir = tempDir("c-import-precompiled-linux", {
        "add.c": "int add(int a, int b) { return a + b; }\n",
        "entry.ts": `import { add } from "./add.c"; console.log(add(1, 2));`,
        "add-wxjnj05q.c": addCompiledForLinuxX64,
        "load.cjs": `console.log(require("./add-wxjnj05q.c").add(1, 2));`,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["load.cjs"]);
      if (isLinux && process.arch === "x64") {
        expect(stderr).toBe("");
        expect(stdout).toBe("3\n");
        expect(exitCode).toBe(0);
        const build = await run(String(dir), ["build", "entry.ts", "--target=bun", "--outdir", "out"]);
        expect(build.exitCode).toBe(0);
        expect(await Bun.file(join(String(dir), "out", "add-wxjnj05q.c")).bytes()).toEqual(
          new Uint8Array(addCompiledForLinuxX64),
        );
      } else {
        expect(stderr).toContain("compiled for a different target");
        expect(stdout).toBe("");
        expect(exitCode).toBe(1);
      }
    },
  );

  test.concurrent("what bun build made of a C file is loaded, not compiled, by import() too", async () => {
    using dir = tempDir("c-import-precompiled", {
      "math.c": mathC,
      "entry.ts": `import { add } from "./math.c"; console.log(add(1, 2));`,
      "load.mjs": `
        const [asset] = [...new Bun.Glob("math-*.c").scanSync("out")];
        const dynamic = await import("./out/" + asset, { with: { type: "c" } });
        const required = require("./out/" + asset);
        console.log(dynamic.add(40, 2), required.add === dynamic.add, Object.keys(dynamic).includes("__bun_run_c_main__"));
      `,
    });
    const build = await run(String(dir), ["build", "entry.ts", "--target=bun", "--outdir", "out"]);
    expect(build.exitCode).toBe(0);
    const { stdout, stderr, exitCode } = await run(String(dir), ["load.mjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("42 true false\n");
    expect(exitCode).toBe(0);
  });
});

// What C hands to the process (an exit or signal handler, a thread's start routine) is an address inside the
// module: it stays loaded for as long as the process runs, whether or not JavaScript still holds its functions.
// A C file is loaded into the process once, like a library a program was linked with: whichever way, how often and
// from however many threads it is asked for, there is one set of its static objects, its constructors run once (when
// a module that imports it is first evaluated, in the order of the imports) and its destructors once.
describe.skipIf(!supported)("a C file is one module in the process", () => {
  const counted = /* c */ `
    #include <stdio.h>
    static int counter;
    __attribute__((constructor)) static void constructed(void) { puts("constructor"); }
    __attribute__((destructor)) static void destroyed(void) { printf("destructor %d\\n", counter); }
    int bump(void) { return ++counter; }
  `;
  const routes: Record<string, string> = {
    // Several at once.
    "together.mjs": `
      const [a, b, c] = await Promise.all([import("./counted.c"), import("./counted.c"), import("./counted.c")]);
      console.log(a === b && b === c, a.bump(), b.bump(), c.bump());
    `,
    "eight.mjs": `
      const all = await Promise.all(Array.from({ length: 8 }, () => import("./counted.c")));
      console.log(all.every(module => module === all[0]), all.map(module => module.bump()).join());
    `,
    // From two modules in the same tick.
    "two-importers.mjs": `
      const [one, other] = await Promise.all([import("./importer-one.mjs"), import("./importer-other.mjs")]);
      console.log(one.bump(), other.bump(), one.bump());
    `,
    "importer-one.mjs": `export { bump } from "./counted.c";`,
    "importer-other.mjs": `const { bump } = await import("./counted.c"); export { bump };`,
    // require() and import, in every order, and at once.
    "require-then-import.mjs": `
      const required = require("./counted.c");
      const imported = await import("./counted.c");
      console.log(required.bump(), imported.bump(), required.bump(), imported.bump());
    `,
    "import-then-require.mjs": `
      const imported = await import("./counted.c");
      const required = require("./counted.c");
      console.log(required.bump(), imported.bump(), required.bump(), imported.bump());
    `,
    "import-racing-require.mjs": `
      const pending = import("./counted.c");
      const required = require("./counted.c");
      const imported = await pending;
      console.log(required.bump(), imported.bump(), required.bump(), imported.bump());
      const again = require("./counted.c"), againImported = await import("./counted.c");
      console.log(again.bump(), againImported.bump());
    `,
    "import-racing-require.cjs": `
      const pending = import("./counted.c");
      const required = require("./counted.c");
      pending.then(imported => console.log(required.bump(), imported.bump(), required.bump(), imported.bump()));
    `,
    // With and without the attribute that says what the file is anyway.
    "attribute.mjs": `
      import * as plain from "./counted.c";
      const attributed = await import("./counted.c", { with: { type: "c" } });
      console.log(plain.bump(), attributed.bump(), plain.bump());
    `,
    // Through another name for the file.
    "symlink.mjs": `
      require("fs").symlinkSync("counted.c", "linked.c");
      const [real, linked] = await Promise.all([import("./counted.c"), import("./linked.c")]);
      console.log(real.bump(), linked.bump(), real.bump());
    `,
    // Forgotten by require() and asked for again: the JavaScript objects are new, the module is the one there is.
    "forgotten.cjs": `
      const first = require("./counted.c");
      delete require.cache[require.resolve("./counted.c")];
      const second = require("./counted.c");
      console.log(first.bump(), second.bump(), first.bump());
    `,
  };
  const expected: Record<string, string> = {
    "together.mjs": "true 1 2 3\n",
    "eight.mjs": "true 1,2,3,4,5,6,7,8\n",
    "two-importers.mjs": "1 2 3\n",
    "require-then-import.mjs": "1 2 3 4\n",
    "import-then-require.mjs": "1 2 3 4\n",
    "import-racing-require.mjs": "1 2 3 4\n5 6\n",
    "import-racing-require.cjs": "1 2 3 4\n",
    "attribute.mjs": "1 2 3\n",
    "symlink.mjs": "1 2 3\n",
    "forgotten.cjs": "1 2 3\n",
  };

  test.concurrent.each(Object.keys(expected))("%s: one constructor, one counter, one destructor", async entry => {
    using dir = tempDir("c-one-module", { ...routes, "counted.c": counted });
    const { stdout, stderr, exitCode } = await run(String(dir), [entry]);
    expect(stderr).toBe("");
    const printed = expected[entry];
    const calls = printed
      .trim()
      .split(/[ ,\n]/)
      .filter(word => /^\d+$/.test(word)).length;
    expect(stdout).toBe(`constructor\n${printed}destructor ${calls}\n`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("C a plugin supplies is one module too, imported and then required", async () => {
    using dir = tempDir("c-one-module-plugin", {
      "plugin.ts": `
        Bun.plugin({
          name: "c",
          setup(build) {
            build.onLoad({ filter: /\\.generated$/ }, () => ({ contents: ${JSON.stringify(counted)}, loader: "c" }));
          },
        });
      `,
      "counted.generated": "",
      "index.mjs": `
        import { bump } from "./counted.generated";
        const required = require("./counted.generated");
        const dynamic = await import("./counted.generated");
        console.log(bump(), required.bump(), dynamic.bump());
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--preload", "./plugin.ts", "index.mjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("constructor\n1 2 3\ndestructor 3\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "Workers and the thread that started them share it: nothing runs its constructors twice",
    async () => {
      using dir = tempDir("c-one-module-workers", {
        "counted.c": /* c */ `
        #include <stdio.h>
        #include <stdatomic.h>
        static atomic_int counter, constructed;
        __attribute__((constructor)) static void construct(void) { atomic_fetch_add(&constructed, 1); puts("constructor"); }
        __attribute__((destructor)) static void destroy(void) { printf("destructor %d\\n", atomic_load(&counter)); }
        int bump(void) { return atomic_fetch_add(&counter, 1) + 1; }
        int constructions(void) { return atomic_load(&constructed); }
      `,
        "worker.mjs": `
        const { bump, constructions } = await import("./counted.c");
        for (let i = 0; i < 1000; i++) bump();
        postMessage(constructions());
      `,
        "index.mjs": `
        import { bump, constructions } from "./counted.c";
        bump();
        const seen = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
          const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
          worker.onmessage = event => resolve(event.data);
          worker.onerror = reject;
        })));
        console.log(seen.join(), constructions(), bump());
      `,
        // A Worker first: the thread that started it finds the module there.
        "worker-first.mjs": `
        const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
        const seen = await new Promise((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = reject; });
        const { bump, constructions } = await import("./counted.c");
        console.log(seen, constructions(), bump());
      `,
      });
      const together = await run(String(dir), ["index.mjs"]);
      expect(together.stderr).toBe("");
      expect(together.stdout).toBe(`constructor\n${Array(8).fill(1).join()} 1 8002\ndestructor 8002\n`);
      expect(together.exitCode).toBe(0);
      const first = await run(String(dir), ["worker-first.mjs"]);
      expect(first.stderr).toBe("");
      expect(first.stdout).toBe("constructor\n1 1 1001\ndestructor 1001\n");
      expect(first.exitCode).toBe(0);
    },
  );

  // Evaluation, not fetching, is when a module has its effects: in the order of the imports.
  test.concurrent(
    "constructors run when the module is evaluated: after what was imported before it, and not at all if that threw",
    async () => {
      using dir = tempDir("c-one-module-order", {
        "counted.c": counted,
        "second.c": `#include <stdio.h>\n__attribute__((constructor)) static void constructed(void) { puts("second constructor"); }\nint second(void) { return 2; }\n`,
        "first.js": `console.log("first.js evaluated");`,
        "throws.js": `throw new Error("stop");`,
        "order.mjs": `import "./first.js"; import "./counted.c"; import "./second.c"; console.log("entry evaluated");`,
        "never.mjs": `import "./throws.js"; import "./counted.c";`,
        "after-await.mjs": `console.log("before"); await 0; const { bump } = await import("./counted.c"); console.log(bump());`,
        "required.cjs": `console.log("before"); const { bump } = require("./counted.c"); console.log(bump());`,
        "worker-order.mjs": `new Worker(new URL("./order.mjs", import.meta.url).href);`,
      });
      const order = await run(String(dir), ["order.mjs"]);
      expect(order.stderr).toBe("");
      expect(order.stdout).toBe("first.js evaluated\nconstructor\nsecond constructor\nentry evaluated\ndestructor 0\n");
      const never = await run(String(dir), ["never.mjs"]);
      expect(never.stderr).toContain("stop");
      expect(never.stdout).toBe("");
      expect(never.exitCode).toBe(1);
      for (const entry of ["after-await.mjs", "required.cjs"]) {
        const { stdout, stderr } = await run(String(dir), [entry]);
        expect(stderr).toBe("");
        expect(stdout).toBe("before\nconstructor\n1\ndestructor 1\n");
      }
      const worker = await run(String(dir), ["worker-order.mjs"]);
      expect(worker.stderr).toBe("");
      expect(worker.stdout).toBe(
        "first.js evaluated\nconstructor\nsecond constructor\nentry evaluated\ndestructor 0\n",
      );
      // The same from a bundle, and from an executable.
      const build = await run(String(dir), ["build", "order.mjs", "--target=bun", "--outdir", "out"]);
      expect(build.exitCode).toBe(0);
      expect((await run(join(String(dir), "out"), ["order.js"])).stdout).toBe(order.stdout);
      const compile = await run(String(dir), ["build", "--compile", "order.mjs", "--outfile", "app"]);
      expect(compile.exitCode).toBe(0);
      expect((await spawned([join(String(dir), executable("app"))], String(dir))).stdout).toBe(order.stdout);
    },
  );
});

describe.skipIf(!supported)("a C module stays loaded", () => {
  // Collects what can be collected and makes the JIT allocate over what was freed.
  const churn = `
    async function churn() {
      for (let i = 0; i < 10; i++) { Bun.gc(true); await new Promise(resolve => setImmediate(resolve)); }
      for (let i = 0; i < 200; i++) { const f = new Function("a", "let s = 0; for (let i = 0; i < 1e5; i++) s += a * " + i + "; return s"); f(1); f(2); }
      Bun.gc(true);
    }
  `;

  test.concurrent("one nothing is imported from: its constructor's atexit handler runs at exit", async () => {
    using dir = tempDir("c-module-lifetime", {
      "init.c": /* c */ `
        #include <stdio.h>
        #include <stdlib.h>
        static const char *message = "bye from init.c";
        static void bye(void) { puts(message); }
        __attribute__((constructor)) static void init(void) { atexit(bye); puts("init ran"); }
      `,
      "main.ts": `import "./init.c"; console.log("js done");`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["main.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("init ran\njs done\nbye from init.c\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("one a terminated Worker imported: its atexit handler runs when the process ends", async () => {
    using dir = tempDir("c-module-lifetime", {
      "lib.c": /* c */ `
        #include <stdio.h>
        #include <stdlib.h>
        static const char *message = "bye from the worker's module";
        static void bye(void) { puts(message); }
        int install(void) { atexit(bye); return 1; }
      `,
      "worker.ts": `import { install } from "./lib.c"; postMessage(install());`,
      "main.ts": `
        ${churn}
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const installed = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
        await worker.terminate();
        await churn();
        console.log("installed", installed);
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["main.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("installed 1\nbye from the worker's module\n");
    expect(exitCode).toBe(0);
  });

  // A file that has changed is another module; the one that was in its place stays, with what it registered.
  test.concurrent(
    "one that require() forgot and whose file then changed: its atexit handler runs, and so does the one loaded in its place",
    async () => {
      using dir = tempDir("c-module-lifetime", {
        "main.cjs": `
        ${churn}
        const source = n => \`
          #include <stdio.h>
          #include <stdlib.h>
          static int loads;
          static void bye(void) { printf("bye %d of generation ${"${n}"}\\\\n", loads); }
          int install(int n) { loads = n; atexit(bye); return n; }
        \`;
        (async () => {
          for (let n = 1; n <= 3; n++) {
            require("fs").writeFileSync("lib.c", source(n));
            require("./lib.c").install(n);
            delete require.cache[require.resolve("./lib.c")];
            await churn();
          }
          console.log("done");
        })();
      `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.cjs"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("done\nbye 3 of generation 3\nbye 2 of generation 2\nbye 1 of generation 1\n");
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent.skipIf(!isPosix)("one whose functions are gone: its signal handler still runs", async () => {
    using dir = tempDir("c-module-lifetime", {
      "sig.c": /* c */ `
        #include <signal.h>
        #include <unistd.h>
        static const char message[] = "handler ran\\n";
        static volatile sig_atomic_t seen;
        static void handler(int signo) { (void)signo; seen = 1; write(1, message, sizeof message - 1); }
        int install(void) { signal(SIGUSR1, handler); return 1; }
      `,
      "main.cjs": `
        ${churn}
        (async () => {
          require("./sig.c").install();
          delete require.cache[require.resolve("./sig.c")];
          await churn();
          process.kill(process.pid, "SIGUSR1");
          console.log("still here");
        })();
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["main.cjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("handler ran\nstill here\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!isPosix)(
    "one whose functions are gone: the thread it started goes on running its code",
    async () => {
      using dir = tempDir("c-module-lifetime", {
        "thread.c": /* c */ `
        #include <pthread.h>
        #include <stdio.h>
        #include <unistd.h>
        static int wake[2], done[2];
        static const char *message = "the thread ran in its module";
        static void *run(void *argument) {
          char byte;
          (void)argument;
          if (read(wake[0], &byte, 1) == 1) { puts(message); fflush(stdout); }
          write(done[1], "x", 1);
          return 0;
        }
        int start(void) {
          pthread_t thread;
          if (pipe(wake) || pipe(done) || pthread_create(&thread, 0, run, 0)) return -1;
          pthread_detach(thread);
          return 0;
        }
        int wake_fd(void) { return wake[1]; }
        int done_fd(void) { return done[0]; }
      `,
        "main.cjs": `
        ${churn}
        const fs = require("fs");
        (async () => {
          let fds;
          (() => { const thread = require("./thread.c"); if (thread.start()) throw new Error("start"); fds = [thread.wake_fd(), thread.done_fd()]; })();
          delete require.cache[require.resolve("./thread.c")];
          await churn();
          fs.writeSync(fds[0], "x");
          fs.readSync(fds[1], Buffer.alloc(1));
          console.log("joined");
        })();
      `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["main.cjs"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("the thread ran in its module\njoined\n");
      expect(exitCode).toBe(0);
    },
  );

  // Modules stay, so a file that keeps changing (under --hot, or here) ends by filling the memory there is for code.
  test.concurrent("when the memory for machine code runs out, importing C is an error like any other", async () => {
    using dir = tempDir("c-module-memory", {
      "index.cjs": `
        const { writeFileSync } = require("fs");
        const body = n => Array.from({ length: 400 }, (_, i) => "int f" + n + "_" + i + "(int x) { int t = x; for (int k = 0; k < 8; k++) t = t * " + (i + 3) + " + k; return t; }").join("\\n");
        let loaded = 0;
        try {
          for (;;) {
            writeFileSync("changing.c", body(loaded));
            if (require("./changing.c")["f" + loaded + "_1"](1) === undefined) throw new Error("not loaded");
            delete require.cache[require.resolve("./changing.c")];
            loaded++;
          }
        } catch (e) {
          console.log(e.name, e.message.replace(/f\\d+_\\d+/, "f"), loaded > 1);
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.cjs"], {
      BUN_JSC_jitMemoryReservationSize: String(1 << 20),
    });
    expect(stderr).toBe("");
    expect(stdout).toBe("TypeError changing.c: out of executable memory for 'f' true\n");
    expect(exitCode).toBe(0);
  });

  // What is loaded again is a file that compiles to something else: the module it was stays, with its handlers.
  test("bun --hot loads the file again each time what it compiles to changes; every copy's atexit handler runs at exit", async () => {
    const source = /* c */ `
      #include <stdio.h>
      #include <stdlib.h>
      #include "edited.h"
      static int id;
      static void bye(void) { printf("bye %d\\n", id); }
      void reg(int n) { id = n; atexit(bye); }
      int generation(void) { return GENERATION; }
    `;
    using dir = tempDir("c-module-hot", {
      "a.c": source,
      "edited.h": "#define GENERATION 0\n",
      "index.ts": `
        import { reg } from "./a.c";
        ${churn}
        globalThis.count = (globalThis.count ?? 0) + 1;
        reg(globalThis.count);
        console.log("run", globalThis.count);
        if (globalThis.count === 4) churn().then(() => process.exit(0));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "index.ts"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const waitFor = follow(proc.stdout);
    // The file itself, then a header it includes, then a comment, which changes nothing of what is loaded.
    await waitFor("run 1\n");
    await Bun.write(join(String(dir), "a.c"), source + "int added(void) { return 1; }\n");
    await waitFor("run 2\n");
    await Bun.write(join(String(dir), "edited.h"), "#define GENERATION 2\n");
    await waitFor("run 3\n");
    await Bun.write(join(String(dir), "edited.h"), "#define GENERATION 2 // still\n");
    // The third module is there twice over: what it registered on the third run and on the fourth.
    await waitFor("run 4\nbye 4\nbye 4\nbye 2\nbye 1\n");
    expect(await proc.exited).toBe(0);
  });
});

describe.skipIf(!supported)("a C file as the entry point", () => {
  test.concurrent(
    "with a main() it is a program: arguments in, exit status out, atexit handlers and stdio flushed",
    async () => {
      using dir = tempDir("c-main", {
        "hello.c": /* c */ `
        #include <stdio.h>
        #include <stdlib.h>
        static void bye(void) { printf("bye\\n"); }
        int main(int argc, char **argv) {
          atexit(bye);
          printf("%d arguments:", argc - 1);
          for (int i = 1; i < argc; i++) printf(" [%s]", argv[i]);
          printf("\\n");
          return 3;
        }
      `,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), [
        "hello.c",
        "one",
        "two words",
        "",
        "--flag",
        "--",
        "é",
      ]);
      expect(stderr).toBe("");
      expect(stdout).toBe("6 arguments: [one] [two words] [] [--flag] [--] [é]\nbye\n");
      expect(exitCode).toBe(3);
    },
  );

  test.concurrent("main() is not called when the file is imported", async () => {
    using dir = tempDir("c-main-imported", {
      "lib.c": `#include <stdio.h>\nint main(void) { puts("main ran"); return 1; }\nint two(void) { return 2; }\n`,
      "index.ts": `import { two } from "./lib.c"; console.log(two());`,
    });
    const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stdout).toBe("2\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("main() is not called in a Worker whose entry point the file is", async () => {
    using dir = tempDir("c-main-worker", {
      "lib.c": `#include <stdio.h>\nint main(void) { puts("main ran"); return 1; }\n`,
      "index.ts": `
        const worker = new Worker(new URL("./lib.c", import.meta.url).href);
        await new Promise(resolve => worker.addEventListener("close", resolve));
        console.log("closed");
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stdout).toBe("closed\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("what imported C wrote to stdout reaches a pipe when the process ends", async () => {
    using dir = tempDir("c-stdio-flush", {
      "say.c": `#include <stdio.h>\nvoid say(const char *text) { printf("%s", text); }\n`,
      "index.ts": `import { say } from "./say.c"; say(Buffer.from("from C, no newline, no fflush\\0"));`,
    });
    const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stdout).toBe("from C, no newline, no fflush");
    expect(exitCode).toBe(0);
  });

  // What main returns is the process's status the way process.exit(status) would make it so.
  const statuses: [string, string, number][] = [
    ["int main(void) { return 0; }", "returns 0", 0],
    ["int main(void) { return 255; }", "returns 255", 255],
    ["int main(void) { return 256; }", "returns 256", 0],
    ["int main(void) { return -1; }", "returns -1", 255],
    ["long main(void) { return 5; }", "is declared long", 5],
    ["long long main(void) { return 0x100000007; }", "returns more than 32 bits", 7],
    ["void main(void) { }", "is declared void", 0],
    ["int main() { return 9; }", "has no prototype", 9],
    ["#include <stdlib.h>\nint main(void) { exit(4); }", "calls exit(4)", 4],
    ["#include <stdlib.h>\nint main(void) { _Exit(6); }", "calls _Exit(6)", 6],
  ];
  test.concurrent.each(statuses)("%s: main %s", async (source, _, status) => {
    using dir = tempDir("c-main-status", { "program.c": source + "\n" });
    const { stdout, stderr, exitCode } = await run(String(dir), ["program.c"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(status);
  });

  test.concurrent("a main with three parameters gets the environment", async () => {
    using dir = tempDir("c-main-envp", {
      "program.c": /* c */ `
        #include <stdio.h>
        #include <string.h>
        int main(int argc, char **argv, char **envp) {
          int found = 0;
          for (char **entry = envp; *entry; entry++) found += strcmp(*entry, "C_MAIN_ENVP=here") == 0;
          printf("%d %d %s\\n", argc, found, argv[argc] == 0 ? "null-terminated" : "not");
          return 0;
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["program.c"], { C_MAIN_ENVP: "here" });
    expect(stderr).toBe("");
    expect(stdout).toBe("1 1 null-terminated\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a main that reads standard input reads the process's", async () => {
    using dir = tempDir("c-main-stdin", {
      "program.c": /* c */ `
        #include <stdio.h>
        int main(void) {
          int c, count = 0;
          while ((c = getchar()) != EOF) { putchar(c >= 'a' && c <= 'z' ? c - 32 : c); count++; }
          printf("%d\\n", count);
          return 0;
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "program.c"],
      env,
      cwd: String(dir),
      stdin: Buffer.from("hello, c\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([text(proc.stdout), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("HELLO, C\n9\n");
    expect(exitCode).toBe(0);
  });

  // What is C is said by a file's name, an import's attribute or --loader: standard input has none of them.
  test.concurrent("`bun -` reads TypeScript, as ever: C given there is not compiled", async () => {
    using dir = tempDir("c-main-dash", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-"],
      env,
      cwd: String(dir),
      stdin: Buffer.from("int main(void) { return 3; }\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([text(proc.stdout), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("[stdin]:1:");
    expect(exitCode).toBe(1);
  });

  // glibc has no `pthread_atfork` in libc.so: a C compiler links a stub that passes the program's `__dso_handle`.
  test.concurrent.skipIf(!isLinux)("pthread_atfork handlers run around fork()", async () => {
    using dir = tempDir("c-main-atfork", {
      "program.c": /* c */ `
        #include <pthread.h>
        #include <stdio.h>
        #include <sys/wait.h>
        #include <unistd.h>
        static int ran;
        static void prepare(void) { ran |= 1; }
        static void parent(void) { ran |= 2; }
        static void child(void) { ran |= 4; }
        int main(void) {
          if (pthread_atfork(prepare, parent, child) != 0) return 1;
          pid_t pid = fork();
          if (pid == 0) _exit(ran);
          int status = 0;
          waitpid(pid, &status, 0);
          printf("parent %d child %d\\n", ran, WEXITSTATUS(status));
          return 0;
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["program.c"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("parent 3 child 5\n");
    expect(exitCode).toBe(0);
  });

  // What every program made with Microsoft's toolchain is linked with: the C runtime and kernel32. Another library
  // is one the program names, as it names it to Microsoft's linker.
  test.concurrent.skipIf(!isWindows)(
    "on Windows a function of user32 is found when the program names the library, and not otherwise",
    async () => {
      const program = (pragma: string) => /* c */ `
        ${pragma}
        int printf(const char *format, ...);
        __declspec(dllimport) int __stdcall GetSystemMetrics(int index);
        __declspec(dllimport) unsigned long __stdcall GetCurrentProcessId(void);
        int main(void) { printf("%d %d\\n", GetSystemMetrics(0) > 0, GetCurrentProcessId() != 0); return 0; }
      `;
      using dir = tempDir("c-main-windows-libraries", {
        "named.c": program(`#pragma comment(lib, "user32.lib")`),
        "unnamed.c": program(""),
      });
      const named = await run(String(dir), ["named.c"]);
      expect(named.stderr).toBe("");
      expect(named.stdout).toBe("1 1\n");
      expect(named.exitCode).toBe(0);
      const unnamed = await run(String(dir), ["unnamed.c"]);
      expect(unnamed.stderr).toContain("undefined symbol 'GetSystemMetrics'");
      expect(unnamed.stdout).toBe("");
      expect(unnamed.exitCode).toBe(1);
    },
  );

  // As `bun module.ts` of a file that only exports is: the module is evaluated, and that is the program.
  test.concurrent(
    "a file without a main is a module that gets loaded: its constructors run, and the process ends",
    async () => {
      using dir = tempDir("c-main-none", {
        "library.c": `#include <stdio.h>\n__attribute__((constructor)) static void loaded(void) { puts("loaded"); }\nint f(void) { return 1; }\n`,
        "empty.c": "\n",
      });
      const library = await run(String(dir), ["library.c", "argument"]);
      expect(library.stderr).toBe("");
      expect(library.stdout).toBe("loaded\n");
      expect(library.exitCode).toBe(0);
      const empty = await run(String(dir), ["empty.c"]);
      expect(empty.stderr).toBe("");
      expect(empty.stdout).toBe("");
      expect(empty.exitCode).toBe(0);
    },
  );

  // To a pipe the program's stdout has a buffer; what is in it when main returns comes before what the listeners print.
  const listen = `process.on("exit", code => console.log("exit event", code, process.exitCode));`;
  test.concurrent.each([
    ["returns 3", `int main(void) { puts("in main"); return 3; }`, "in main\nexit event 3 3\n", 3],
    [
      "has registered an atexit handler: that runs when the process is nearly gone",
      `static void handler(void) { puts("atexit handler"); }\nint main(void) { atexit(handler); puts("in main"); return 3; }`,
      "in main\nexit event 3 3\natexit handler\n",
      3,
    ],
    [
      "has printed more than its buffer holds",
      `int main(void) { for (int i = 0; i < 3000; i++) puts("line"); return 0; }`,
      repeated("line\n", 3000) + "exit event 0 undefined\n",
      0,
    ],
    // C's exit() is the C library's: it ends the process without JavaScript's listeners.
    ["calls exit(3) itself", `int main(void) { puts("in main"); exit(3); }`, "in main\n", 3],
  ] as [string, string, string, number][])(
    "the process ends the way process.exit(status) ends it: 'exit' listeners run and see the status; main %s",
    async (_, body, printed, status) => {
      using dir = tempDir("c-main-exit-event", {
        "listen.ts": listen,
        "program.c": `#include <stdio.h>\n#include <stdlib.h>\n${body}\n`,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["--preload", "./listen.ts", "program.c"]);
      expect(stderr).toBe("");
      expect(stdout).toBe(printed);
      expect(exitCode).toBe(status);
    },
  );

  test.concurrent("what main printed reaches a file before what 'exit' listeners print", async () => {
    using dir = tempDir("c-main-exit-event-file", {
      "listen.ts": listen,
      "program.c": `#include <stdio.h>\nint main(void) { puts("in main"); return 3; }\n`,
    });
    const out = join(String(dir), "out.txt");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./listen.ts", "program.c"],
      env,
      cwd: String(dir),
      stdout: Bun.file(out),
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect((await Bun.file(out).text()).replaceAll("\r\n", "\n")).toBe("in main\nexit event 3 3\n");
    expect(exitCode).toBe(3);
  });

  test.concurrent("process.exit() in JavaScript that main called: what main had printed comes first", async () => {
    using dir = tempDir("c-main-exit-callback", {
      "callback.ts": `
        import { JSCallback } from "bun:ffi";
        const callback = new JSCallback(() => process.exit(7), { args: [], returns: "void" });
        await Bun.write("callback.txt", String(callback.ptr));
        process.on("exit", code => console.log("exit event", code));
      `,
      "program.c": /* c */ `
        #include <stdio.h>
        int main(void) {
          unsigned long long address = 0;
          FILE *file = fopen("callback.txt", "r");
          if (!file || fscanf(file, "%llu", &address) != 1) return 1;
          puts("before the callback");
          ((void (*)(void))address)();
          puts("after the callback");
          return 2;
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--preload", "./callback.ts", "program.c"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("before the callback\nexit event 7\n");
    expect(exitCode).toBe(7);
  });

  test.concurrent("--cpu-prof writes its profile", async () => {
    using dir = tempDir("c-main-cpu-prof", {
      "program.c": `int main(void) { volatile int n = 0; for (int i = 0; i < 1000000; i++) n += i; return 0; }\n`,
    });
    const { stderr, exitCode } = await run(String(dir), ["--cpu-prof", "--cpu-prof-dir", "profiles", "program.c"]);
    expect(stderr).toBe("");
    expect([...new Bun.Glob("*.cpuprofile").scanSync(join(String(dir), "profiles"))].length).toBe(1);
    expect(exitCode).toBe(0);
  });

  // Bun makes C's stdout unbuffered for itself; a C program that is the entry point has it to itself.
  test.concurrent("stdout is buffered as it is for a program of its own: a block at a time to a pipe", async () => {
    using dir = tempDir("c-main-buffering", {
      "program.c": /* c */ `
          #include <stdio.h>
          #ifdef _WIN32
          #include <io.h>
          #define write _write
          #else
          #include <unistd.h>
          #endif
          int main(void) { printf("a"); write(1, "b", 1); printf("c\\n"); fprintf(stderr, "e"); write(2, "f", 1); return 0; }
        `,
      "imported.ts": `import { main } from "./program.c"; main();`,
    });
    const program = await run(String(dir), ["program.c"]);
    expect(program.stdout).toBe("bac\n");
    expect(program.stderr).toBe("ef");
    expect(program.exitCode).toBe(0);
    // Imported C shares stdout with console.log: there it stays unbuffered, so the two interleave in order.
    const imported = await run(String(dir), ["imported.ts"]);
    expect(imported.stdout).toBe("abc\n");
    expect(imported.stderr).toBe("ef");
  });

  // As a program GCC or Clang built ends: what `atexit` was given runs last registered first, and a module's
  // destructors are on that list from before its constructors run.
  const endings: [string, string, string][] = [
    [
      "a handler a constructor registered runs before the destructors",
      /* c */ `
        static void from_constructor(void) { puts("handler the constructor registered"); }
        static void from_main(void) { puts("handler main registered"); }
        __attribute__((constructor)) static void construct(void) { atexit(from_constructor); }
        __attribute__((destructor)) static void destroy(void) { puts("destructor"); }
        int main(void) { atexit(from_main); return 0; }
      `,
      "handler main registered\nhandler the constructor registered\ndestructor\n",
    ],
    [
      "constructors and destructors with priorities, each constructor registering a handler",
      /* c */ `
        static void first(void) { puts("handler of the constructor with priority 101"); }
        static void second(void) { puts("handler of the constructor with priority 102"); }
        static void from_main(void) { puts("handler main registered"); }
        __attribute__((constructor(101))) static void construct_first(void) { puts("constructor 101"); atexit(first); }
        __attribute__((constructor(102))) static void construct_second(void) { puts("constructor 102"); atexit(second); }
        __attribute__((destructor(101))) static void destroy_first(void) { puts("destructor 101"); }
        __attribute__((destructor(102))) static void destroy_second(void) { puts("destructor 102"); }
        int main(void) { atexit(from_main); return 0; }
      `,
      "constructor 101\nconstructor 102\nhandler main registered\nhandler of the constructor with priority 102\nhandler of the constructor with priority 101\ndestructor 102\ndestructor 101\n",
    ],
    [
      "a handler registered by a handler, and one registered by a destructor, run next",
      /* c */ `
        static void late(void) { puts("handler a handler registered"); }
        static void from_destructor(void) { puts("handler the destructor registered"); }
        static void from_constructor(void) { puts("handler the constructor registered"); atexit(late); }
        static void from_main(void) { puts("handler main registered"); }
        __attribute__((constructor)) static void construct(void) { atexit(from_constructor); }
        __attribute__((destructor)) static void destroy(void) { puts("destructor"); atexit(from_destructor); }
        int main(void) { atexit(from_main); return 0; }
      `,
      "handler main registered\nhandler the constructor registered\nhandler a handler registered\ndestructor\nhandler the destructor registered\n",
    ],
  ];
  test.concurrent.each(endings)("at the end %s", async (_, source, printed) => {
    using dir = tempDir("c-main-endings", {
      "program.c": `#include <stdio.h>\n#include <stdlib.h>\n${source}`,
      // Imported, the module's part of the list is the same; nothing calls main.
      "imported.ts": `import "./program.c";`,
    });
    const program = await run(String(dir), ["program.c"]);
    expect(program.stderr).toBe("");
    expect(program.stdout).toBe(printed);
    expect(program.exitCode).toBe(0);
    const imported = await run(String(dir), ["imported.ts"]);
    expect(imported.stderr).toBe("");
    expect(imported.stdout).toBe(printed.replace("handler main registered\n", ""));
    expect(imported.exitCode).toBe(0);
  });

  test.concurrent("two modules: the one loaded later is done with first", async () => {
    const module = (name: string) => /* c */ `
      #include <stdio.h>
      #include <stdlib.h>
      static void handler(void) { puts("handler of ${name}'s constructor"); }
      __attribute__((constructor)) static void construct(void) { atexit(handler); }
      __attribute__((destructor)) static void destroy(void) { puts("destructor of ${name}"); }
    `;
    using dir = tempDir("c-main-endings-two", {
      "first.c": module("first"),
      "second.c": module("second"),
      "index.ts": `import "./first.c"; import "./second.c";`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      "handler of second's constructor\ndestructor of second\nhandler of first's constructor\ndestructor of first\n",
    );
    expect(exitCode).toBe(0);
  });

  // Bun keeps both lists for compiled C, on every platform.
  test.concurrent(
    "quick_exit runs at_quick_exit handlers and not atexit ones; any other end the other way round",
    async () => {
      using dir = tempDir("c-main-quick-exit", {
        "program.c": /* c */ `
        #include <stdio.h>
        #include <stdlib.h>
        #include <string.h>
        static void at_exit_handler(void) { puts("atexit handler"); fflush(stdout); }
        static void first_quick(void) { puts("at_quick_exit handler, registered first"); fflush(stdout); }
        static void second_quick(void) { puts("at_quick_exit handler, registered second"); fflush(stdout); }
        void setup(void) {
          atexit(at_exit_handler);
          at_quick_exit(first_quick);
          at_quick_exit(second_quick);
        }
        int main(int argc, char **argv) {
          setup();
          if (argc > 1 && !strcmp(argv[1], "exit")) exit(2);
          if (argc > 1 && !strcmp(argv[1], "return")) return 2;
          if (argc > 1 && !strcmp(argv[1], "_Exit")) _Exit(2);
          quick_exit(2);
        }
      `,
        "imported.ts": `
        import { setup } from "./program.c";
        setup();
        const how = process.argv[2];
        if (how === "exit") process.exit(2);
        if (how === "exitCode") process.exitCode = 2;
        if (how === "throw") throw new Error("thrown");
      `,
      });
      const quick = await run(String(dir), ["program.c"]);
      expect(quick.stdout).toBe("at_quick_exit handler, registered second\nat_quick_exit handler, registered first\n");
      expect(quick.exitCode).toBe(2);
      for (const how of ["exit", "return"]) {
        const normal = await run(String(dir), ["program.c", how]);
        expect(normal.stdout).toBe("atexit handler\n");
        expect(normal.exitCode).toBe(2);
      }
      const immediate = await run(String(dir), ["program.c", "_Exit"]);
      expect(immediate.stdout).toBe("");
      expect(immediate.exitCode).toBe(2);
      // However a JavaScript program that imported the C ends, that is not quick_exit.
      for (const [how, status] of [
        ["normally", 0],
        ["exit", 2],
        ["exitCode", 2],
        ["throw", 1],
      ] as [string, number][]) {
        const imported = await run(String(dir), ["imported.ts", how]);
        expect(imported.stdout).toBe("atexit handler\n");
        expect(imported.exitCode).toBe(status);
      }
    },
  );

  // A fault in the program's own C is reported as that, not as a bug in Bun.
  const faults: [string, string][] = [
    ["a null store", 'int main(void) { puts("before"); fflush(stdout); *(volatile int *)8 = 1; return 0; }'],
    ["abort()", 'int main(void) { puts("before"); fflush(stdout); abort(); }'],
    ["a failed assert", 'int main(void) { puts("before"); fflush(stdout); assert(1 == 2); return 0; }'],
  ];
  test.concurrent.each(faults)("%s in main is the program's crash", async (name, body) => {
    using dir = tempDir("c-main-crash", {
      "program.c": `#include <assert.h>\n#include <stdio.h>\n#include <stdlib.h>\n${body}\n`,
    });
    // Where there is a shell, it is told to write no core file: that takes longer than the test has.
    const cmd = [bunExe(), "program.c"];
    const { stdout, stderr, exitCode, signalCode } = await spawned(
      isPosix ? ["/bin/sh", "-c", 'ulimit -c 0 && exec "$@"', "--", ...cmd] : cmd,
      String(dir),
    );
    expect(stdout).toBe("before\n");
    expect(stderr).not.toContain("This indicates a bug in Bun, not your code");
    if (isWindows && name !== "a null store") {
      // Microsoft's abort() ends the process with __fastfail, which no handler sees: the status is the
      // system's, as it is for an executable a C compiler made, and assert has said why first.
      if (name === "a failed assert") expect(stderr).toContain("Assertion failed");
      expect(exitCode).not.toBe(0);
      return;
    }
    // Said once.
    expect(stderr.split("a C program's main() was running").length).toBe(2);
    expect(stderr).toContain("c_module");
    // A signal where there are signals; on Windows the status the system gives a faulting process.
    if (isPosix) expect(signalCode).not.toBeNull();
    else expect(exitCode).not.toBe(0);
  });
});

describe.skipIf(!supported)("a crash in imported C", () => {
  // Called from JavaScript, C is not a program of its own whose crash is its own: the report is Bun's usual one, and
  // says that C was loaded.
  test.skipIf(!isPosix)("says in the report that C was loaded", async () => {
    using dir = tempDir("c-import-crash", {
      "fault.c": "int fault(void) { return *(volatile int *)8; }\n",
      "index.ts": `import { fault } from "./fault.c"; console.log("before"); fault();`,
    });
    const { stdout, stderr, exitCode, signalCode } = await spawned(
      ["/bin/sh", "-c", 'ulimit -c 0 && exec "$@"', "--", bunExe(), "index.ts"],
      String(dir),
    );
    expect(stdout).toBe("before\n");
    expect(stderr).toMatch(/Features:.* c_module/);
    expect(stderr).not.toContain("a C program's main() was running");
    expect(exitCode === 0 || signalCode === null).toBe(false);
  });
});

describe.skipIf(!supported)("--watch", () => {
  test("restarts when the .c file, or a header it includes, changes; also after a compile error", async () => {
    using dir = tempDir("c-import-watch", {
      "value.h": "#define VALUE 1\n",
      "a.c": '#include "value.h"\nint answer(void) { return VALUE; }\n',
      "index.ts": `import { answer } from "./a.c"; console.log("answer = " + answer());`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--watch", "index.ts"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const waitFor = follow(proc.stdout);
    const waitForError = follow(proc.stderr);
    await waitFor("answer = 1");
    await Bun.write(join(String(dir), "a.c"), '#include "value.h"\nint answer(void) { return VALUE + 10; }\n');
    await waitFor("answer = 11");
    await Bun.write(join(String(dir), "value.h"), "#define VALUE 2\n");
    await waitFor("answer = 12");
    await Bun.write(join(String(dir), "a.c"), '#include "value.h"\nint answer(void) { return VALUE + ; }\n');
    await waitForError("a.c:2:");
    await Bun.write(join(String(dir), "a.c"), '#include "value.h"\nint answer(void) { return VALUE + 20; }\n');
    await waitFor("answer = 22");
    proc.kill();
  });

  test.each(["--watch", "--hot"])(
    "bun %s program.c runs the program again when it, or a header, changes",
    async flag => {
      const program = (extra: string) => /* c */ `
      #include <stdio.h>
      #include <stdlib.h>
      #include "value.h"
      static void bye(void) { printf("bye %d\\n", VALUE); }
      int main(void) { atexit(bye); printf("value = %d%s", VALUE, "${extra}\\n"); return VALUE; }
    `;
      using dir = tempDir("c-main-watch", { "value.h": "#define VALUE 1\n", "program.c": program("") });
      await using proc = Bun.spawn({
        cmd: [bunExe(), flag, "program.c"],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const waitFor = follow(proc.stdout);
      const waitForError = follow(proc.stderr);
      // Each run's atexit handlers run when its main returns: once a run, not piling up for the last one.
      await waitFor("value = 1\nbye 1\n");
      await Bun.write(join(String(dir), "value.h"), "#define VALUE 2\n");
      await waitFor("value = 2\nbye 2\n");
      await Bun.write(join(String(dir), "program.c"), program("!"));
      await waitFor("value = 2!\nbye 2\n");
      await Bun.write(join(String(dir), "program.c"), program("!").replace("return VALUE;", "return VALUE +;"));
      await waitForError("program.c:6:");
      await Bun.write(join(String(dir), "program.c"), program("?"));
      await waitFor("value = 2?\nbye 2\n");
      expect(proc.exitCode).toBe(null);
      proc.kill();
    },
  );

  test("bun build --watch rebuilds when a header the .c file includes changes", async () => {
    using dir = tempDir("c-build-watch", {
      "value.h": "#define VALUE 1\n",
      "a.c": '#include "value.h"\nint answer(void) { return VALUE; }\n',
      "index.ts": `import { answer } from "./a.c"; console.log("answer = " + answer());`,
    });
    await using builder = Bun.spawn({
      cmd: [bunExe(), "build", "--watch", "--target", "bun", "index.ts", "--outdir", "out"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    // Every build, the first included, reports what it wrote on stdout.
    const built = follow(builder.stdout);
    const bundle = join(String(dir), "out", "index.js");
    await built("index.js");
    expect((await run(String(dir), [bundle])).stdout).toBe("answer = 1\n");
    await Bun.write(join(String(dir), "value.h"), "#define VALUE 7\n");
    await built("index.js");
    expect((await run(String(dir), [bundle])).stdout).toBe("answer = 7\n");
    builder.kill();
  });
});

describe.skipIf(!supported)("bundling a .c file", () => {
  const files = {
    "math.c": mathC,
    "index.ts": `import { add, mix } from "./math.c"; console.log(add(40, 2), mix(12345));`,
  };
  const magic = new TextEncoder().encode("BIR0");

  test.concurrent("bun build emits the compiled form as an asset and a bundle that loads it", async () => {
    using dir = tempDir("c-bundle", files);
    const build = await run(String(dir), ["build", "index.ts", "--target=bun", "--outdir", "out"]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);

    const out = join(String(dir), "out");
    const assets = [...new Bun.Glob("math-*.c").scanSync(out)];
    expect(assets.length).toBe(1);
    // Not C any more: what the runtime turns into machine code without a parser or headers.
    expect((await Bun.file(join(out, assets[0])).bytes()).subarray(0, 4)).toEqual(magic);

    const { stdout, exitCode } = await run(out, ["index.js"]);
    expect(stdout.trim()).toBe("42 2435775735");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--outfile has nowhere to put the compiled form, and says so", async () => {
    using dir = tempDir("c-bundle-outfile", files);
    const build = await run(String(dir), ["build", "index.ts", "--target=bun", "--outfile", "out.js"]);
    expect(build.stderr).toContain("cannot write multiple output files without an output directory");
    expect(build.exitCode).toBe(1);
  });

  // The bundle says what the asset is; nothing depends on what the asset is called.
  test.concurrent.each([
    ["[name]-[hash]", []],
    ["[name].[ext]", []],
    ["assets/[name]-[hash].bin", []],
    ["[dir]/[name]-[hash].[ext]", ["--format=cjs"]],
  ] as [string, string[]][])(
    "--asset-naming %s: the bundle loads the asset whatever it is called",
    async (naming, more) => {
      using dir = tempDir("c-bundle-naming", files);
      const build = await run(String(dir), [
        "build",
        "index.ts",
        "--target=bun",
        "--outdir",
        "out",
        "--asset-naming",
        naming,
        ...more,
      ]);
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await run(join(String(dir), "out"), ["index.js"]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("42 2435775735");
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("a file that is C because the import or --loader says so is C in the bundle too", async () => {
    using dir = tempDir("c-bundle-typed", {
      "add.txt": "int add(int a, int b) { return a + b; }\n",
      "add.x": "int add(int a, int b) { return a + b + 100; }\n",
      "index.ts": `
        import { add as byAttribute } from "./add.txt" with { type: "c" };
        import { add as byExtension } from "./add.x";
        console.log(byAttribute(5, 6), byExtension(5, 6));
      `,
    });
    const build = await run(String(dir), ["build", "index.ts", "--loader", ".x:c", "--target=bun", "--outdir", "out"]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    // Also where the one running the bundle has given `.c` and `.x` other meanings.
    for (const flags of [[], ["--loader", ".c:file", "--loader", ".x:text", "--loader", ".txt:file"]]) {
      const { stdout, stderr, exitCode } = await run(join(String(dir), "out"), [...flags, "index.js"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("11 111\n");
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("the bundler knows the file's exports: only a name it does not define is an error", async () => {
    using dir = tempDir("c-bundle-missing", {
      "math.c": mathC,
      "index.ts": `import { add, nope } from "./math.c"; console.log(add, nope);`,
    });
    const build = await run(String(dir), ["build", "index.ts", "--target=bun", "--outdir", "out"]);
    expect(build.stderr).toContain('No matching export in "math.c" for import "nope"');
    expect(build.stderr).not.toContain('for import "add"');
    expect(build.exitCode).not.toBe(0);
  });

  test.concurrent("a C compile error is a build error", async () => {
    using dir = tempDir("c-bundle-error", {
      "broken.c": "int f(void) { return undeclared_thing; }\n",
      "index.ts": `import { f } from "./broken.c"; console.log(f());`,
    });
    const build = await run(String(dir), ["build", "index.ts", "--target=bun", "--outdir", "out"]);
    expect(build.stderr).toContain("error: use of undeclared identifier 'undeclared_thing'\n    at ");
    expect(build.stderr).toContain("broken.c:1:22\n");
    expect(build.exitCode).not.toBe(0);
  });

  // The compiler is told the files' names relative to where the build runs (that is what __FILE__ is); what a
  // message says is the absolute path, as for JavaScript, wherever the build runs.
  test.concurrent(
    "a message about C names its file by the absolute path, as a message about JavaScript does",
    async () => {
      using dir = tempDir("c-bundle-error-path", {
        "sub/g.c": `#include "h/bad.h"\nint g(void) { return BAD; }\n`,
        "sub/h/bad.h": "#define BAD (\n#error broken here\n",
        "warn.c": "#warning careful\nint w(void) { return 1; }\n",
        "main.c": "int helper(int);\nint main(void) { return helper(1); }\n",
        "helper.c": "int helper(int x) { return undeclared_thing; }\n",
        "header.ts": `import { g } from "./sub/g.c"; console.log(g());`,
        "warning.ts": `import { w } from "./warn.c"; console.log(w());`,
        "javascript.ts": `import { nope } from "./other.ts"; console.log(nope);`,
        "other.ts": "export const yes = 1;\n",
        "build.ts": `
        import { join } from "path";
        const root = import.meta.dir;
        const files = async (...entrypoints: string[]) => {
          const result = await Bun.build({ entrypoints: entrypoints.map(entry => join(root, entry)), target: "bun", outdir: join(root, "out"), throw: false });
          return result.logs.map(log => log.level + " " + log.position?.file).join();
        };
        for (const where of [root, join(root, "sub"), "/"]) {
          process.chdir(where);
          console.log(await files("header.ts"), await files("warning.ts"), await files("main.c", "helper.c"), await files("javascript.ts"));
        }
      `,
      });
      const root = String(dir);
      const api = await run(root, ["build.ts"]);
      expect(api.stderr).toBe("");
      const line = `error ${join(root, "sub", "h", "bad.h")} warn ${join(root, "warn.c")} error ${join(root, "helper.c")} error ${join(root, "javascript.ts")}\n`;
      expect(api.stdout).toBe(line + line + line);
      // The command line says the same from any directory.
      for (const [cwd, entry] of [
        [root, "header.ts"],
        [join(root, "sub"), "../header.ts"],
      ]) {
        const cli = await run(cwd, ["build", entry, "--target=bun", "--outdir", join(root, "cli")]);
        expect(cli.stderr).toContain(`at ${join(root, "sub", "h", "bad.h")}:2:1`);
        expect(cli.exitCode).not.toBe(0);
      }
    },
  );

  test.concurrent.each(["browser", "node"])(
    "--target=%s cannot run C: that is the error, whether or not the C compiles, and it names the file",
    async target => {
      using dir = tempDir("c-bundle-target", {
        "good.c": "int f(void) { return 1; }\n",
        "bad.c": "int f( { return 1; }\n",
        "good.ts": `import { f } from "./good.c"; console.log(f());`,
        "bad.ts": `import { f } from "./bad.c"; console.log(f());`,
        "both.ts": `import { f } from "./good.c"; import { f as g } from "./bad.c"; console.log(f(), g());`,
        "build.ts": `
          const result = await Bun.build({ entrypoints: ["./both.ts"], target: ${JSON.stringify(target)}, outdir: "api", throw: false });
          console.log(result.success, JSON.stringify(result.logs.map(log => [log.message, log.position?.file]).sort()));
        `,
      });
      for (const entry of ["good.ts", "bad.ts"]) {
        const build = await run(String(dir), ["build", entry, `--target=${target}`, "--outdir", "out"]);
        expect(build.stderr).toContain('To import a ".c" file, set target to "bun"');
        expect(build.stderr).toContain(join(String(dir), entry.replace(".ts", ".c")));
        expect(build.stderr).not.toContain("expected");
        expect(build.exitCode).not.toBe(0);
      }
      // One message for each file, each with its file.
      const api = await run(String(dir), ["build.ts"]);
      expect(api.stderr).toBe("");
      const message = 'To import a ".c" file, set target to "bun"';
      expect(api.stdout).toBe(
        `false ${JSON.stringify([
          [message, join(String(dir), "bad.c")],
          [message, join(String(dir), "good.c")],
        ])}\n`,
      );
    },
  );

  test.concurrent("an import only for its effects loads the module: its constructors run", async () => {
    using dir = tempDir("c-bundle-side-effect", {
      "init.c": `#include <stdio.h>\n__attribute__((constructor)) static void boot(void) { puts("constructor ran"); fflush(stdout); }\nint unused(void) { return 1; }\n`,
      "bare.ts": `import "./init.c"; console.log("js");`,
      // (In TypeScript an import nothing uses is a type's, and is erased.)
      "unused.mjs": `import { unused } from "./init.c"; console.log("js");`,
      "required.cjs": `require("./init.c"); console.log("js");`,
    });
    for (const [entry, flags] of [
      ["bare.ts", []],
      ["bare.ts", ["--minify"]],
      ["unused.mjs", []],
      ["required.cjs", ["--format=cjs"]],
    ] as [string, string[]][]) {
      const unbundled = await run(String(dir), [entry]);
      expect(unbundled.stdout).toBe("constructor ran\njs\n");
      const build = await run(String(dir), ["build", entry, ...flags, "--target=bun", "--outdir", "out"]);
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);
      const bundled = await run(join(String(dir), "out"), [entry.replace(/\.\w+$/, ".js")]);
      expect(bundled.stderr).toBe("");
      expect(bundled.stdout).toBe("constructor ran\njs\n");
      expect(bundled.exitCode).toBe(0);
    }
  });

  // A module has the same exports however it got into the bundle; being an entry point adds running main.
  const library = {
    "add.c": `#include <stdio.h>\nint add(int a, int b) { return a + b; }\nint mul(int a, int b) { return a * b; }\nstatic int hidden(int a) { return a; }\n`,
    "program.c": `#include <stdio.h>\nint twice(int a) { return a * 2; }\nint main(int argc, char **argv) { printf("main %d\\n", twice(argc)); fflush(stdout); return 5; }\n`,
    "index.ts": `import { add } from "./add.c"; console.log(add(2, 3));`,
    "use.ts": `const library = await import("./out/add.js"); console.log(Object.keys(library).sort().join(), library.add(2, 3), library.default.mul(2, 3));`,
  };

  test.concurrent("an entry point that is a C file has its exports", async () => {
    using dir = tempDir("c-bundle-entry", library);
    const build = await run(String(dir), ["build", "add.c", "--target=bun", "--outdir", "out"]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    const { stdout, stderr, exitCode } = await run(String(dir), ["use.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("add,default,mul 5 6\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
    ["index.ts", "add.c"],
    ["add.c", "index.ts"],
  ])("bun build %s %s: a C file that is an entry point and imported by another", async (first, second) => {
    using dir = tempDir("c-bundle-entry", library);
    const build = await run(String(dir), ["build", first, second, "--target=bun", "--outdir", "out"]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    const index = await run(join(String(dir), "out"), ["index.js"]);
    expect(index.stdout).toBe("5\n");
    expect(index.exitCode).toBe(0);
    const use = await run(String(dir), ["use.ts"]);
    expect(use.stdout).toBe("add,default,mul 5 6\n");
    expect(use.exitCode).toBe(0);
  });

  test.concurrent(
    "an entry point with a main is that program, with its arguments and status; imported, it is its exports",
    async () => {
      using dir = tempDir("c-bundle-entry", {
        ...library,
        "import-program.ts": `import { twice } from "./program.c"; console.log(twice(21));`,
      });
      for (const format of ["esm", "cjs"]) {
        const build = await run(String(dir), [
          "build",
          "program.c",
          "import-program.ts",
          `--format=${format}`,
          "--target=bun",
          "--outdir",
          "out",
        ]);
        expect(build.stderr).toBe("");
        expect(build.exitCode).toBe(0);
        const program = await run(join(String(dir), "out"), ["program.js", "one", "two"]);
        expect(program.stderr).toBe("");
        expect(program.stdout).toBe("main 6\n");
        expect(program.exitCode).toBe(5);
        const imported = await run(join(String(dir), "out"), ["import-program.js"]);
        expect(imported.stdout).toBe("42\n");
        expect(imported.exitCode).toBe(0);
      }
    },
  );

  test.concurrent("export * from a C file hands on its functions, bundled as it does unbundled", async () => {
    using dir = tempDir("c-bundle-export-star", {
      ...library,
      "star.ts": `export * from "./add.c";`,
      "through.ts": `export * from "./star.ts";`,
      "named.ts": `export { add as plus } from "./add.c"; export * as all from "./add.c";`,
      "use.ts": `
        const names = ns => Object.keys(ns).sort().join();
        const [star, through, named] = await Promise.all([import(process.argv[2] + "/star.js"), import(process.argv[2] + "/through.js"), import(process.argv[2] + "/named.js")]);
        console.log(names(star), names(through), names(named), star.add(1, 2), through.mul(2, 3), named.plus(3, 4), names(named.all));
      `,
      "unbundled.ts": `
        import * as star from "./star.ts"; import * as through from "./through.ts"; import * as named from "./named.ts";
        const names = ns => Object.keys(ns).sort().join();
        console.log(names(star), names(through), names(named), star.add(1, 2), through.mul(2, 3), named.plus(3, 4), names(named.all));
      `,
    });
    const expected = "add,mul add,mul all,plus 3 6 7 add,default,mul\n";
    expect((await run(String(dir), ["unbundled.ts"])).stdout).toBe(expected);
    const build = await run(String(dir), [
      "build",
      "star.ts",
      "through.ts",
      "named.ts",
      "--target=bun",
      "--outdir",
      "out",
    ]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);
    const bundled = await run(String(dir), ["use.ts", join(String(dir), "out")]);
    expect(bundled.stderr).toBe("");
    expect(bundled.stdout).toBe(expected);
  });

  // With --splitting what several entry points share is a chunk of its own: a C file's statements may be in it while
  // the entry point that runs its main is another output, and import() of a C file gets an output of its own.
  const split = {
    ...library,
    "import-program.ts": `import { twice } from "./program.c"; console.log(twice(21));`,
    "import-again.ts": `import { twice } from "./program.c"; console.log(twice(4));`,
    "require-program.cjs": `const { twice } = require("./program.c"); console.log(twice(21));`,
    "dynamic-program.ts": `const program = await import("./program.c"); console.log(program.twice(21), typeof program.main);`,
    "dynamic-add.ts": `const library = await import("./add.c"); console.log(library.add(40, 2));`,
    // (Names the output the other entry point becomes.)
    "worker-main.ts": `const worker = new Worker(new URL("./worker.js", import.meta.url).href); worker.onmessage = event => { console.log(event.data); worker.terminate(); };`,
    "worker.ts": `import { twice } from "./program.c"; postMessage(twice(21));`,
  };
  const outputsOf = (dir: string) =>
    [...new Bun.Glob("*.js").scanSync(dir)].map(name => Bun.file(join(dir, name)).text());

  test.concurrent.each([
    [["program.c", "import-program.ts"], []],
    [["import-program.ts", "program.c"], []],
    [["program.c", "import-program.ts"], ["--minify"]],
    [["import-program.ts", "import-again.ts", "program.c"], []],
    [["program.c", "require-program.cjs"], []],
    [["program.c", "dynamic-program.ts"], []],
    [["program.c"], []],
  ] as [string[], string[]][])(
    "bun build --splitting %j %j: the entry point that is a C program runs its main, the others have its exports",
    async (entries, flags) => {
      using dir = tempDir("c-bundle-splitting", split);
      const build = await run(String(dir), [
        "build",
        ...entries,
        ...flags,
        "--splitting",
        "--target=bun",
        "--outdir",
        "out",
      ]);
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);
      const out = join(String(dir), "out");
      const program = await run(out, ["program.js", "one", "two"]);
      expect(program.stderr).toBe("");
      expect(program.stdout).toBe("main 6\n");
      expect(program.exitCode).toBe(5);
      for (const [entry, printed] of [
        ["import-program", "42\n"],
        ["import-again", "8\n"],
        ["require-program", "42\n"],
        ["dynamic-program", "42 function\n"],
      ]) {
        if (!entries.some(name => name.startsWith(entry + "."))) continue;
        const other = await run(out, [entry + ".js"]);
        expect(other.stderr).toBe("");
        expect(other.stdout).toBe(printed);
        expect(other.exitCode).toBe(0);
      }
    },
  );

  test.concurrent.each([[[]], [["--minify"]], [["--splitting"]], [["--splitting", "--minify"]]])(
    "bun build %j: import() of a C file with a main is its exports, as it is unbundled",
    async flags => {
      using dir = tempDir("c-bundle-dynamic", split);
      const unbundled = await run(String(dir), ["dynamic-program.ts"]);
      expect(unbundled.stdout).toBe("42 function\n");
      const build = await run(String(dir), [
        "build",
        "dynamic-program.ts",
        "dynamic-add.ts",
        "require-program.cjs",
        "worker-main.ts",
        "worker.ts",
        ...flags,
        "--target=bun",
        "--outdir",
        "out",
      ]);
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);
      const out = join(String(dir), "out");
      // Nothing here is a C program: no output runs a main.
      for (const output of await Promise.all(outputsOf(out))) expect(output).not.toContain("__bun_run_c_main__");
      for (const [entry, printed] of [
        ["dynamic-program.js", "42 function\n"],
        ["dynamic-add.js", "42\n"],
        ["require-program.js", "42\n"],
        ["worker-main.js", "42\n"],
      ]) {
        const { stdout, stderr, exitCode } = await run(out, [entry]);
        expect(stderr).toBe("");
        expect(stdout).toBe(printed);
        expect(exitCode).toBe(0);
      }
    },
  );

  test.concurrent("a C file without a main that is an entry point has nothing to run", async () => {
    using dir = tempDir("c-bundle-no-main", split);
    for (const flags of [[], ["--splitting"]]) {
      const build = await run(String(dir), ["build", "add.c", "index.ts", ...flags, "--target=bun", "--outdir", "out"]);
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);
      for (const output of await Promise.all(outputsOf(join(String(dir), "out"))))
        expect(output).not.toContain("__bun_run_c_main__");
      const use = await run(String(dir), ["use.ts"]);
      expect(use.stdout).toBe("add,default,mul 5 6\n");
      expect(use.exitCode).toBe(0);
    }
  });

  test.concurrent("Bun.build({ splitting: true }) makes what bun build --splitting makes", async () => {
    using dir = tempDir("c-bundle-splitting-api", {
      ...split,
      "build.ts": `
        const result = await Bun.build({ entrypoints: ["./import-program.ts", "./program.c", "./dynamic-program.ts"], splitting: true, target: "bun", outdir: "out" });
        console.log(result.success, result.outputs.map(output => output.kind).sort().join());
        for (const log of result.logs) console.log(String(log));
      `,
    });
    const build = await run(String(dir), ["build.ts"]);
    expect(build.stderr).toBe("");
    expect(build.stdout).toBe("true asset,chunk,entry-point,entry-point,entry-point\n");
    const out = join(String(dir), "out");
    const program = await run(out, ["program.js"]);
    expect(program.stdout).toBe("main 2\n");
    expect(program.exitCode).toBe(5);
    expect((await run(out, ["import-program.js"])).stdout).toBe("42\n");
    expect((await run(out, ["dynamic-program.js"])).stdout).toBe("42 function\n");
  });

  test.each([
    [["program.c", "import-program.ts"], "main 6\n", 5],
    [["import-program.ts", "program.c"], "42\n", 0],
    [["dynamic-program.ts"], "42 function\n", 0],
  ] as [string[], string, number][])(
    "bun build --compile --splitting %j is its first entry point",
    async (entries, printed, status) => {
      using dir = tempDir("c-compile-splitting", split);
      const build = await run(String(dir), ["build", "--compile", "--splitting", ...entries, "--outfile", "prog"]);
      expect(build.stderr).not.toContain("error");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned(
        [join(String(dir), executable("prog")), "one", "two"],
        String(dir),
      );
      expect(stderr).toBe("");
      expect(stdout).toBe(printed);
      expect(exitCode).toBe(status);
    },
  );

  test.concurrent("Bun.build makes what bun build makes", async () => {
    using dir = tempDir("c-bundle-api", {
      ...library,
      "build.ts": `
        const result = await Bun.build({ entrypoints: ["./index.ts", "./add.c"], target: "bun", outdir: "out" });
        console.log(result.success, result.outputs.map(output => output.kind).sort().join());
        for (const log of result.logs) console.log(String(log));
      `,
    });
    const build = await run(String(dir), ["build.ts"]);
    expect(build.stderr).toBe("");
    expect(build.stdout).toBe("true asset,entry-point,entry-point\n");
    const index = await run(join(String(dir), "out"), ["index.js"]);
    expect(index.stdout).toBe("5\n");
    const use = await run(String(dir), ["use.ts"]);
    expect(use.stdout).toBe("add,default,mul 5 6\n");
  });

  // What is compiled names its files relative to where the build runs, not by where the project is checked out.
  test.concurrent("the same project builds the same asset wherever it is checked out", async () => {
    const project = {
      "src/checked.c": `#include <assert.h>\n#include "where.h"\nint checked(int x) { assert(x > 0); return x; }\nconst char *file(void) { return __FILE__; }\nconst char *header(void) { return where(); }\n`,
      "src/where.h": `static const char *where(void) { return __FILE__; }\n`,
      "index.ts": `import { checked, file, header } from "./src/checked.c"; import { CString } from "bun:ffi"; console.log(checked(3), new CString(file()).toString(), new CString(header()).toString());`,
    };
    using one = tempDir("c-bundle-here", project);
    using other = tempDir("c-bundle-somewhere-else-entirely", project);
    const assets: Uint8Array[] = [];
    for (const dir of [one, other]) {
      const build = await run(String(dir), ["build", "index.ts", "--target=bun", "--outdir", "out"]);
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);
      const out = join(String(dir), "out");
      const [asset] = [...new Bun.Glob("checked-*.c").scanSync(out)];
      assets.push(await Bun.file(join(out, asset)).bytes());
      expect(basename(asset)).toBe(basename([...new Bun.Glob("checked-*.c").scanSync(join(String(one), "out"))][0]));
      const { stdout, exitCode } = await run(out, ["index.js"]);
      expect(stdout.replaceAll("\\", "/")).toBe("3 src/checked.c src/where.h\n");
      expect(exitCode).toBe(0);
    }
    expect(assets[0]).toEqual(assets[1]);
    expect(Buffer.from(assets[0]).includes(basename(String(one)))).toBe(false);
  });

  test("Bun.build gives back the memory a C file's compiled form took", async () => {
    using dir = tempDir("c-bundle-memory", {
      // A megabyte of string is a megabyte of compiled form.
      "big.c": `static const char text[] = "${Buffer.alloc(1 << 20, "0123456789abcdef").toString()}";\nint at(int i) { return text[i]; }\n`,
      "index.ts": `import { at } from "./big.c"; console.log(at(5));`,
      "loop.ts": `
        const build = async () => { const result = await Bun.build({ entrypoints: ["./index.ts"], target: "bun", outdir: "out" }); if (!result.success) throw new Error("build failed"); };
        for (let i = 0; i < 10; i++) await build();
        Bun.gc(true);
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 80; i++) await build();
        Bun.gc(true);
        console.log(Math.round((process.memoryUsage.rss() - before) / 1024 / 1024));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["loop.ts"]);
    expect(stderr).toBe("");
    // Kept, 80 builds would be 80 MB and more.
    expect(Number(stdout)).toBeLessThan(isASAN || isDebug ? 60 : 40);
    expect(exitCode).toBe(0);
  });

  test("bun build --compile of a C file with main() is that program", async () => {
    using dir = tempDir("c-compile-main", {
      "hello.c": /* c */ `
        #include <stdio.h>
        int main(int argc, char **argv) {
          printf("%d:", argc - 1);
          for (int i = 1; i < argc; i++) printf(" [%s]", argv[i]);
          // The executable itself can be opened by the name it was given.
          FILE *self = fopen(argv[0], "rb");
          printf(" %s\\n", self ? "argv[0] is a file" : argv[0]);
          return 7;
        }
      `,
    });
    const build = await run(String(dir), ["build", "--compile", "hello.c", "--outfile", "hello"]);
    expect(build.exitCode).toBe(0);
    const { stdout, stderr, exitCode } = await spawned(
      [join(String(dir), executable("hello")), "one", "two words"],
      String(dir),
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("2: [one] [two words] argv[0] is a file\n");
    expect(exitCode).toBe(7);
  });

  // With --bytecode the entry point is compiled ahead of time, as CommonJS or as an ES module: the statement that
  // runs main is part of it.
  test.each([[["--bytecode", "--format=cjs"]], [["--bytecode", "--format=esm"]], [["--format=cjs"]], [["--minify"]]])(
    "bun build --compile %j of a C file with main() is that program",
    async flags => {
      using dir = tempDir("c-compile-main-flags", {
        "hello.c": `#include <stdio.h>\nint main(int argc, char **argv) { printf("%d %s\\n", argc, argc > 1 ? argv[1] : ""); return 4; }\n`,
      });
      const build = await run(String(dir), ["build", "--compile", ...flags, "hello.c", "--outfile", "hello"]);
      expect(build.stderr).not.toContain("error");
      expect(build.exitCode).toBe(0);
      const { stdout, stderr, exitCode } = await spawned([join(String(dir), executable("hello")), "one"], String(dir));
      expect(stderr).toBe("");
      expect(stdout).toBe("2 one\n");
      expect(exitCode).toBe(4);
    },
  );

  // What an executable was started with is known when it is built, as `import.meta.main` of an entry point written
  // in JavaScript is: the statement that runs main asks nothing at run time. (A bundle's asks `import.meta.main`.)
  test("in an executable the statement that runs main is unconditional, from bun build and from Bun.build", async () => {
    using dir = tempDir("c-compile-main-statement", {
      "hello.c": `#include <stdio.h>\nint main(void) { puts("hello"); return 0; }\n`,
      "build.ts": `
        const result = await Bun.build({ entrypoints: ["./hello.c"], compile: { outfile: "./api" } });
        if (!result.success) throw new Error("build failed");
      `,
    });
    expect((await run(String(dir), ["build", "--compile", "hello.c", "--outfile", "cli"])).exitCode).toBe(0);
    expect((await run(String(dir), ["build.ts"])).exitCode).toBe(0);
    expect((await run(String(dir), ["build", "hello.c", "--target=bun", "--outdir", "out"])).exitCode).toBe(0);
    const statement = (bytes: Buffer) => {
      const call = bytes.indexOf(".__bun_run_c_main__()");
      expect(call).toBeGreaterThan(0);
      const before = bytes.subarray(0, call).toString("latin1");
      return before.slice(before.lastIndexOf("\n") + 1).replace(/__require\(.*$/, "");
    };
    for (const name of ["cli", "api"]) {
      const exe = join(String(dir), executable(name));
      expect(statement(Buffer.from(await Bun.file(exe).bytes()))).toBe("");
      expect((await spawned([exe], String(dir))).stdout).toBe("hello\n");
    }
    expect(statement(Buffer.from(await Bun.file(join(String(dir), "out", "hello.js")).bytes()))).toBe(
      "import.meta.main && ",
    );
  });

  test("bun build --compile of several C files links them into one program", async () => {
    using dir = tempDir("c-compile-multi", {
      "shared.h": "extern int calls;\nint twice(int);\nint counted(void);\n",
      "main.c": /* c */ `
        #include <stdio.h>
        #include "shared.h"
        static int helper(void) { return 1; }
        int main(void) {
          printf("%d %d %d %d\\n", twice(20) + 2, counted(), calls, helper());
          return 0;
        }
      `,
      "util.c":
        '#include "shared.h"\nint calls;\nstatic int helper(void) { return 100; }\nint twice(int x) { calls++; return x * 2; }\n',
      "sub/count.c": '#include "../shared.h"\nint counted(void) { return calls + twice(0); }\n',
    });
    // Named twice, and by another spelling: still one file.
    const build = await run(String(dir), [
      "build",
      "--compile",
      "main.c",
      "util.c",
      "./sub/count.c",
      "sub/../util.c",
      "--outfile",
      "prog",
    ]);
    expect(build.stderr).not.toContain("error");
    expect(build.exitCode).toBe(0);
    const { stdout, stderr, exitCode } = await spawned([join(String(dir), executable("prog"))], String(dir));
    expect(stderr).toBe("");
    expect(stdout).toBe("42 1 2 1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("several C entry points are one program to Bun.build and without --compile too", async () => {
    using dir = tempDir("c-bundle-multi", {
      "main.c": `#include <stdio.h>\nint helper(int);\nint main(void) { printf("%d\\n", helper(20)); return 0; }\n`,
      "helper.c": `int helper(int x) { return x * 2 + 2; }\n`,
      "build.ts": `
        const result = await Bun.build({ entrypoints: ["./main.c", "./helper.c"], target: "bun", outdir: "api" });
        console.log(result.success, result.outputs.map(output => output.kind).sort().join());
        for (const log of result.logs) console.log(String(log));
      `,
    });
    const api = await run(String(dir), ["build.ts"]);
    expect(api.stderr).toBe("");
    expect(api.stdout).toBe("true asset,entry-point\n");
    const cli = await run(String(dir), ["build", "main.c", "helper.c", "--target=bun", "--outdir", "cli"]);
    expect(cli.stderr).toBe("");
    expect(cli.exitCode).toBe(0);
    for (const out of ["api", "cli"]) {
      const { stdout, exitCode } = await run(join(String(dir), out), ["main.js"]);
      expect(stdout).toBe("42\n");
      expect(exitCode).toBe(0);
    }
    const missing = await run(String(dir), [
      "build",
      "main.c",
      "helper.c",
      "nowhere.c",
      "--target=bun",
      "--outdir",
      "cli",
    ]);
    expect(missing.stderr).toContain("nowhere.c");
    expect(missing.exitCode).not.toBe(0);
  });

  // Each of a program's files is found and read the way any input of a build is.
  test.concurrent(
    "the files of a C program come from Bun.build's files and from plugins as any input does",
    async () => {
      const main = `#include <stdio.h>\nint helper(int);\nint main(void) { printf("%d\\n", helper(20)); return 0; }\n`;
      using dir = tempDir("c-bundle-multi-sources", {
        "main.c": main,
        "helper.c": `int helper(int x) { return x + 1; }\n`,
        "sub/unused.txt": "",
        "build.ts": `
        import { join } from "path";
        const root = import.meta.dir;
        const main = ${JSON.stringify(main)};
        // Files that are nowhere but in the build's \`files\`, in a directory that is not there either.
        const inMemory = name => join(root, "in-memory", name);
        const builds = {
          files: {
            entrypoints: [inMemory("main.c"), inMemory("helper.c")],
            files: { [inMemory("main.c")]: main, [inMemory("helper.c")]: "int helper(int x) { return x * 2 + 2; }" },
          },
          "one from files": {
            entrypoints: ["./main.c", inMemory("helper.c")],
            files: { [inMemory("helper.c")]: "int helper(int x) { return x * 3; }" },
          },
          onLoad: {
            entrypoints: ["./main.c", "./helper.c"],
            plugins: [{ name: "rewrite", setup(builder) {
              builder.onLoad({ filter: /helper\\.c$/ }, async args => ({ contents: (await Bun.file(args.path).text()).replace("x + 1", "x + 100"), loader: "c" }));
            } }],
          },
          "onLoad of the program": {
            entrypoints: ["./main.c", "./helper.c"],
            plugins: [{ name: "rewrite", setup(builder) {
              builder.onLoad({ filter: /main\\.c$/ }, async args => ({ contents: (await Bun.file(args.path).text()).replace("helper(20)", "helper(50)") }));
            } }],
          },
          onResolve: {
            entrypoints: ["./main.c", "./elsewhere.c"],
            plugins: [{ name: "redirect", setup(builder) {
              builder.onResolve({ filter: /elsewhere\\.c$/ }, () => ({ path: join(root, "helper.c") }));
            } }],
          },
          "another spelling": { entrypoints: ["./main.c", "./sub/../helper.c", "./helper.c"] },
          "one that is not there": { entrypoints: ["./main.c", "./helper.c", "./nowhere.c"] },
        };
        for (const [name, options] of Object.entries(builds)) {
          const result = await Bun.build({ ...options, target: "bun", outdir: join(root, "out", name), throw: false });
          const program = result.outputs.find(output => output.kind === "entry-point")?.path ?? "";
          console.log(name + ":", result.success, result.outputs.map(output => output.kind).sort().join(), result.logs.map(log => log.message).join("|"), "#" + program);
        }
      `,
      });
      const build = await run(String(dir), ["build.ts"]);
      expect(build.stderr).toBe("");
      const builds = build.stdout
        .trimEnd()
        .split("\n")
        .map(line => line.split("#"));
      expect(builds.slice(0, 6).map(([said]) => said)).toEqual(
        ["files", "one from files", "onLoad", "onLoad of the program", "onResolve", "another spelling"].map(
          name => `${name}: true asset,entry-point  `,
        ),
      );
      expect(builds[6][0]).toStartWith("one that is not there: false ");
      expect(builds[6][0]).toContain("nowhere.c");
      const printed = ["42\n", "60\n", "120\n", "51\n", "21\n", "21\n"];
      for (let i = 0; i < printed.length; i++) {
        const { stdout, stderr, exitCode } = await run(String(dir), [builds[i][1]]);
        expect(stderr).toBe("");
        expect(stdout).toBe(printed[i]);
        expect(exitCode).toBe(0);
      }
    },
  );

  test.concurrent.skipIf(!isPosix)(
    "a file of a C program may be a symbolic link, also to another of its files",
    async () => {
      using dir = tempDir("c-bundle-multi-symlink", {
        "main.c": `#include <stdio.h>\nint helper(int);\nint main(void) { printf("%d\\n", helper(20)); return 0; }\n`,
        "helper.c": `int helper(int x) { return x + 1; }\n`,
      });
      symlinkSync("helper.c", join(String(dir), "linked.c"));
      for (const entries of [
        ["main.c", "linked.c"],
        ["main.c", "helper.c", "linked.c"],
      ]) {
        const build = await run(String(dir), ["build", ...entries, "--target=bun", "--outdir", "out"]);
        expect(build.stderr).toBe("");
        expect(build.exitCode).toBe(0);
        const { stdout, exitCode } = await run(join(String(dir), "out"), ["main.js"]);
        expect(stdout).toBe("21\n");
        expect(exitCode).toBe(0);
      }
    },
  );

  test("bun build --compile embeds the compiled form; the executable needs neither the source nor a C parser", async () => {
    using dir = tempDir("c-compile", files);
    const build = await run(String(dir), ["build", "--compile", "index.ts", "--outfile", "app"]);
    expect(build.exitCode).toBe(0);

    using elsewhere = tempDir("c-compile-run", {});
    const exe = join(String(elsewhere), executable("app"));
    await Bun.write(exe, Bun.file(join(String(dir), executable("app"))));
    chmodSync(exe, 0o755);

    const { stdout, exitCode } = await spawned([exe], String(elsewhere));
    expect(stdout.trim()).toBe("42 2435775735");
    expect(exitCode).toBe(0);
  });

  // The ordinary pass-through plugin: what it hands over is compiled like the file it read.
  test("Bun.build({ compile }) embeds the compiled form of C a plugin's onLoad supplied", async () => {
    using dir = tempDir("c-compile-plugin", {
      "add.c": `#include "inc.h"\nint add(int a, int b) { return a + b + INC; }\n`,
      "inc.h": "#define INC 7\n",
      "use.ts": `
        import { add } from "./add.c";
        const embedded = await Promise.all(Bun.embeddedFiles.map(async file => new TextDecoder().decode((await file.bytes()).subarray(0, 4))));
        console.log(add(2, 3), embedded.join());
      `,
      "build.ts": `
        const result = await Bun.build({
          entrypoints: ["./use.ts"],
          compile: { outfile: "./app" },
          plugins: [{ name: "c", setup(builder) {
            builder.onLoad({ filter: /add\\.c$/ }, async args => ({ contents: await Bun.file(args.path).text(), loader: "c" }));
          } }],
        });
        console.log(result.success);
        for (const log of result.logs) console.log(String(log));
      `,
    });
    const build = await run(String(dir), ["build.ts"]);
    expect(build.stderr).toBe("");
    expect(build.stdout).toBe("true\n");

    using elsewhere = tempDir("c-compile-plugin-run", {});
    const exe = join(String(elsewhere), executable("app"));
    await Bun.write(exe, Bun.file(join(String(dir), executable("app"))));
    chmodSync(exe, 0o755);
    const { stdout, stderr, exitCode } = await spawned([exe], String(elsewhere));
    expect(stderr).toBe("");
    expect(stdout).toBe("12 BIR0\n");
    expect(exitCode).toBe(0);
  });

  // The C in an executable is compiled for the platform the executable is for. No build gets as far as fetching
  // that platform's runtime: the address it would come from is one nothing listens on.
  const elsewhere = { BUN_COMPILE_TARGET_TARBALL_URL: "http://127.0.0.1:1/bun.tgz" };
  const unsupportedTargets = [
    "bun-linux-x64-musl",
    "bun-linux-arm64",
    "bun-linux-arm64-musl",
    "bun-darwin-x64",
    "bun-windows-arm64",
    "bun-freebsd-x64",
  ];
  test.concurrent.each(unsupportedTargets)(
    "--compile --target=%s: C does not run there, and the build says so",
    async target => {
      using dir = tempDir("c-compile-target", { ...files, "plain.ts": `console.log("no C here");` });
      const build = await run(
        String(dir),
        ["build", "--compile", `--target=${target}`, "index.ts", "--outfile", "app"],
        elsewhere,
      );
      expect(build.stderr).toContain(
        `Compiling C for ${target} is not supported yet (it is for Linux x64 (glibc), macOS arm64 and Windows x64)`,
      );
      // Which file it is that is C.
      expect(build.stderr).toContain(join(String(dir), "math.c"));
      expect(build.exitCode).not.toBe(0);
    },
  );

  // The other platforms C is compiled for. What shows which one a file was compiled for is in the file; the build
  // then stops where it would fetch that platform's runtime.
  const host = isWindows ? "bun-windows-x64" : isLinux ? "bun-linux-x64" : "bun-darwin-arm64";
  const macros: Record<string, [string, number]> = {
    "bun-windows-x64": ["_WIN32", 4],
    "bun-darwin-arm64": ["__APPLE__", 8],
    "bun-linux-x64": ["__linux__", 8],
  };
  test.concurrent.each(Object.keys(macros).filter(target => target !== host))(
    "--compile --target=%s: C is compiled for that platform, with headers from C_INCLUDE_PATH",
    async target => {
      const [macro, long] = macros[target];
      const program = (size: number) =>
        `#ifndef ${macro}\n#error compiled for another platform\n#endif\n_Static_assert(sizeof(long) == ${size}, "the size of long");\nint main(void) { return 0; }\n`;
      using dir = tempDir("c-compile-cross", {
        "right.c": program(long),
        "wrong.c": program(12 - long),
        "header.c": "#include <widget.h>\nint main(void) { return WIDGET; }\n",
        "include/widget.h": "#define WIDGET 3\n",
      });
      const build = (file: string, extra: Record<string, string> = {}) =>
        run(String(dir), ["build", "--compile", `--target=${target}`, file, "--outfile", "app"], {
          ...elsewhere,
          ...extra,
        });
      const right = await build("right.c");
      expect(right.stderr).not.toContain("error:");
      expect(right.stderr).toContain("Failed to download");
      const wrong = await build("wrong.c");
      expect(wrong.stderr).toContain("error: static assertion failed: the size of long");
      expect(wrong.stderr).not.toContain("compiled for another platform");
      // This machine's headers are not that platform's: only what C_INCLUDE_PATH names is searched, and a header
      // that is not there is one error that says so.
      const missing = await build("header.c");
      expect(missing.stderr).toContain("error: 'widget.h' file not found");
      expect(missing.stderr).toContain(
        "note: the headers of a target that is not this machine are looked for in the directories of C_INCLUDE_PATH only",
      );
      const found = await build("header.c", { C_INCLUDE_PATH: join(String(dir), "include") });
      expect(found.stderr).not.toContain("error:");
      expect(found.stderr).toContain("Failed to download");
    },
  );

  test.concurrent(
    "Bun.build({ compile: { target } }) compiles C for that target as bun build --compile --target does",
    async () => {
      using dir = tempDir("c-compile-target-api", {
        ...files,
        "build.ts": `
        for (const target of ${JSON.stringify(unsupportedTargets)}) {
          const result = await Bun.build({ entrypoints: ["./index.ts"], compile: { target, outfile: "app" }, throw: false });
          console.log(target, result.success, result.logs.map(String).join("|"));
        }
      `,
      });
      const { stdout, stderr } = await run(String(dir), ["build.ts"], elsewhere);
      expect(stderr).toBe("");
      expect(stdout).toBe(
        unsupportedTargets
          .map(
            target =>
              `${target} false BuildMessage: Compiling C for ${target} is not supported yet (it is for Linux x64 (glibc), macOS arm64 and Windows x64)\n`,
          )
          .join(""),
      );
    },
  );

  test.concurrent("a damaged asset is an error where it is loaded, never a crash", async () => {
    using dir = tempDir("c-bundle-damaged", {
      "program.c": `#include <stdio.h>\nint main(int argc, char **argv) { printf("hi %d\\n", argc); return 3; }\n`,
      "damage.ts": `
        import { join } from "path";
        const [asset] = [...new Bun.Glob("program-*.c").scanSync("out")];
        const good = await Bun.file(join("out", asset)).bytes();
        let loaded = 0, refused = 0;
        const attempt = async (bytes: Uint8Array, name: string) => {
          await Bun.write(join("damaged", name), bytes);
          try { require(join(process.cwd(), "damaged", name)); loaded++; } catch { refused++; }
        };
        // One of three ways of changing a byte at each place, in turn. (Every way at every place, and random
        // damage, are the decoder's own tests.)
        for (let at = 0; at < good.length; at++) {
          const bytes = good.slice();
          bytes[at] ^= [0x01, 0x80, 0xff][at % 3];
          await attempt(bytes, "flip-" + at + ".c");
        }
        for (let length = 0; length < good.length; length++) await attempt(good.subarray(0, length), "cut-" + length + ".c");
        console.log("tried", loaded + refused, "refused some:", refused > 0);
      `,
    });
    const build = await run(String(dir), ["build", "program.c", "--target=bun", "--outdir", "out"]);
    expect(build.exitCode).toBe(0);
    const [asset] = [...new Bun.Glob("program-*.c").scanSync(join(String(dir), "out"))];
    const size = (await Bun.file(join(String(dir), "out", asset)).bytes()).length;
    const { stdout, stderr, exitCode } = await run(String(dir), ["damage.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`tried ${size * 2} refused some: true\n`);
    expect(exitCode).toBe(0);
  });

  test("the compiled form carries a module's bytes, not the space between them", async () => {
    using dir = tempDir("c-bundle-data", {
      // Constants are on pages of their own, 16 KiB apart from what the program writes to.
      "small.c": `
        const char *const greeting = "hello";
        int counter = 41;
        int next(void) { return ++counter; }
      `,
      // More initialized data than anything counted in the format may number.
      "big.c": `
        char big[17 << 20] = { [0] = 7, [(17 << 20) - 1] = 1 };
        const char table[17 << 20] = { [1] = 3, [(17 << 20) - 1] = 2 };
        int ends(void) { return big[0] * 1000 + big[(17 << 20) - 1] * 100 + table[1] * 10 + table[(17 << 20) - 1]; }
      `,
      "index.ts": `
        import { next } from "./small.c";
        import { ends } from "./big.c";
        console.log(next(), ends());
      `,
    });
    const unbundled = await run(String(dir), ["index.ts"]);
    expect(unbundled.stderr).toBe("");
    expect(unbundled.stdout).toBe("42 7132\n");
    expect(unbundled.exitCode).toBe(0);

    const build = await run(String(dir), ["build", "index.ts", "--target=bun", "--outdir", "out"]);
    expect(build.stderr).not.toContain("error:");
    expect(build.exitCode).toBe(0);
    const out = join(String(dir), "out");
    const sizeOf = (name: string) =>
      [...new Bun.Glob(name + "-*.c").scanSync(out)].map(asset => Bun.file(join(out, asset)).size);
    // A few hundred bytes of code and data, and none of the 16 KiB between its two parts.
    expect(sizeOf("small")).toEqual([expect.any(Number)]);
    expect(sizeOf("small")[0]).toBeLessThan(4096);
    // Each array's two ends, 17 MiB apart, and the zeros after the last one dropped.
    expect(sizeOf("big")[0]).toBeGreaterThan(2 * (17 << 20) - 4096);
    expect(sizeOf("big")[0]).toBeLessThan(2 * (17 << 20) + 4096);
    const bundled = await run(String(dir), [join("out", "index.js")]);
    expect(bundled.stderr).toBe("");
    expect(bundled.stdout).toBe("42 7132\n");
    expect(bundled.exitCode).toBe(0);
  });
});
