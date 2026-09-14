import { describe, expect, test } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isPosix, isWindows, tempDir } from "harness";
import { basename, join } from "path";
import { supported } from "./bir/run-fixtures";

// `import … from "./x.c"` compiles the file with Bun's own C compiler (bun_cc + JavaScriptCore's B3).
// C's stdout is in text mode on Windows: "\r\n" there.
const text = async (stream: ReadableStream<Uint8Array>) => (await stream.text()).replaceAll("\r\n", "\n");
// What `bun build --compile --outfile name` makes.
const executable = (name: string) => (isWindows ? name + ".exe" : name);
// A developer's own C_INCLUDE_PATH would put other headers in front of the system's.
const env: Record<string, string | undefined> = { ...bunEnv, C_INCLUDE_PATH: undefined };

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

// Where compiled C does not run yet, saying so is all that importing a `.c` file does; asking for the file
// itself is what it always was.
describe.skipIf(supported)("where C is not supported", () => {
  const files = {
    "add.c": "int add(int a, int b) { return a + b; }\n",
    "compiles.ts": `import { add } from "./add.c"; console.log(add(1, 2));`,
  };

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

  test.concurrent(
    "the JavaScript thread goes on while the pool compiles; top-level await waits for the module",
    async () => {
      using dir = tempDir("c-import-await", {
        "math.c": mathC,
        "awaited.mjs": `export const { add } = await import("./math.c"); export const order = ["awaited"];`,
        "index.mjs": `
        import { add as early, order } from "./awaited.mjs";
        import { add } from "./math.c";
        let resolved = false;
        const pending = import("./other.c").then(module => { resolved = true; return module; });
        // Nothing has been awaited since import() was called: the file cannot have been compiled on this thread.
        const before = resolved;
        const other = await pending;
        console.log(early === add, add(1, 2), other.triple(3), before, resolved, order.join());
      `,
        "other.c": "int triple(int x) { return x * 3; }\n",
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["index.mjs"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("true 3 9 false true awaited\n");
      expect(exitCode).toBe(0);
    },
  );

  // On Linux a file can include the name of the thread that reads it: what is there is not C, so the error quotes it.
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

  test.concurrent("Workers importing the same file at the same time each get their own module", async () => {
    using dir = tempDir("c-import-workers", {
      "counter.c": "static int calls;\nint next(void) { return ++calls; }\n",
      "worker.mjs": `
        const { next } = await import("./counter.c");
        let last = 0;
        for (let i = 0; i < 1000; i++) last = next();
        postMessage(last);
      `,
      "index.mjs": `
        const results = await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
          const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
          worker.onmessage = event => resolve(event.data);
          worker.onerror = reject;
        })));
        console.log(results.join());
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.mjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(Array(8).fill(1000).join() + "\n");
    expect(exitCode).toBe(0);
  });

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

  test.concurrent(
    "one that require() forgot: its atexit handler runs, and so does the one loaded in its place",
    async () => {
      using dir = tempDir("c-module-lifetime", {
        "lib.c": /* c */ `
        #include <stdio.h>
        #include <stdlib.h>
        static int loads;
        static void bye(void) { printf("bye %d\\n", loads); }
        int install(int n) { loads = n; atexit(bye); return n; }
      `,
        "main.cjs": `
        ${churn}
        (async () => {
          for (let n = 1; n <= 3; n++) {
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
      expect(stdout).toBe("done\nbye 3\nbye 2\nbye 1\n");
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

  test("bun --hot loads the file again each time it changes; every copy's atexit handler runs at exit", async () => {
    const source = /* c */ `
      #include <stdio.h>
      #include <stdlib.h>
      #include "edited.h"
      static int id;
      static void bye(void) { printf("bye %d\\n", id); }
      void reg(int n) { id = n; atexit(bye); }
    `;
    using dir = tempDir("c-module-hot", {
      "a.c": source,
      "edited.h": "// 0\n",
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
    // The file itself, then a header it includes.
    for (let n = 1; n <= 3; n++) {
      await waitFor(`run ${n}\n`);
      if (n === 2) await Bun.write(join(String(dir), "edited.h"), `// ${n}\n`);
      else await Bun.write(join(String(dir), "a.c"), source + `// ${n}\n`);
    }
    await waitFor("run 4\nbye 4\nbye 3\nbye 2\nbye 1\n");
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

  test.concurrent(
    "the process ends the way process.exit(status) ends it: 'exit' listeners run and see the status",
    async () => {
      using dir = tempDir("c-main-exit-event", {
        "listen.ts": `process.on("exit", code => console.log("exit event", code, process.exitCode));`,
        "program.c": `#include <stdio.h>\nint main(void) { puts("in main"); fflush(stdout); return 3; }\n`,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["--preload", "./listen.ts", "program.c"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("in main\nexit event 3 3\n");
      expect(exitCode).toBe(3);
    },
  );

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
  test.concurrent.skipIf(!isPosix)(
    "stdout is buffered as it is for a program of its own: a block at a time to a pipe",
    async () => {
      using dir = tempDir("c-main-buffering", {
        "program.c": /* c */ `
          #include <stdio.h>
          #include <unistd.h>
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
    },
  );

  test.concurrent.skipIf(!isPosix)("quick_exit runs at_quick_exit handlers and not atexit ones", async () => {
    using dir = tempDir("c-main-quick-exit", {
      "program.c": /* c */ `
        #include <stdio.h>
        #include <stdlib.h>
        static void at_exit_handler(void) { puts("atexit handler"); fflush(stdout); }
        static void at_quick_exit_handler(void) { puts("at_quick_exit handler"); fflush(stdout); }
        int main(int argc, char **argv) {
          atexit(at_exit_handler);
          at_quick_exit(at_quick_exit_handler);
          if (argc > 1) exit(2);
          quick_exit(2);
        }
      `,
    });
    const quick = await run(String(dir), ["program.c"]);
    expect(quick.stdout).toBe("at_quick_exit handler\n");
    expect(quick.exitCode).toBe(2);
    const normal = await run(String(dir), ["program.c", "exit"]);
    expect(normal.stdout).toBe("atexit handler\n");
    expect(normal.exitCode).toBe(2);
  });

  // A fault in the program's own C is reported as that, not as a bug in Bun.
  const faults: [string, string][] = [
    ["a null store", 'int main(void) { puts("before"); fflush(stdout); *(volatile int *)8 = 1; return 0; }'],
    ["abort()", 'int main(void) { puts("before"); fflush(stdout); abort(); }'],
    ["a failed assert", 'int main(void) { puts("before"); fflush(stdout); assert(1 == 2); return 0; }'],
  ];
  test.concurrent.each(faults)("%s in main is the program's crash", async (_, body) => {
    using dir = tempDir("c-main-crash", {
      "program.c": `#include <assert.h>\n#include <stdio.h>\n#include <stdlib.h>\n${body}\n`,
    });
    // Where there is a shell, it is told to write no core file: that takes longer than the test has.
    const cmd = [bunExe(), "program.c"];
    const { stdout, stderr, exitCode, signalCode } = await spawned(
      isPosix ? ["/bin/sh", "-c", 'ulimit -c 0 && exec "$@"', "--", ...cmd] : cmd,
      String(dir),
      { BUN_ENABLE_CRASH_REPORTING: "0" },
    );
    expect(stdout).toBe("before\n");
    expect(stderr).toContain("a C program's main() was running");
    expect(stderr).toContain("c_module");
    expect(stderr).not.toContain("This indicates a bug in Bun, not your code");
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
      { BUN_ENABLE_CRASH_REPORTING: "0" },
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

  test.concurrent.each(["browser", "node"])(
    "--target=%s cannot run C: that is the error, whether or not the C compiles",
    async target => {
      using dir = tempDir("c-bundle-target", {
        "good.c": "int f(void) { return 1; }\n",
        "bad.c": "int f( { return 1; }\n",
        "good.ts": `import { f } from "./good.c"; console.log(f());`,
        "bad.ts": `import { f } from "./bad.c"; console.log(f());`,
      });
      for (const entry of ["good.ts", "bad.ts"]) {
        const build = await run(String(dir), ["build", entry, `--target=${target}`, "--outdir", "out"]);
        expect(build.stderr).toContain('To import a ".c" file, set target to "bun"');
        expect(build.stderr).not.toContain("expected");
        expect(build.exitCode).not.toBe(0);
      }
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
      expect(build.exitCode).not.toBe(0);
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
});
