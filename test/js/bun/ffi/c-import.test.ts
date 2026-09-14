import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { existsSync } from "fs";
import { join } from "path";

// `import … from "./x.c"` compiles the file with Bun's own C compiler (bun_cc + JavaScriptCore's B3).
// These have run on Linux x64, macOS arm64 and Windows x64.
const supported =
  (isLinux && !isArm64) ||
  (isMacOS && isArm64) ||
  // (with Visual Studio's and the Windows SDK's headers, which the C in these tests includes)
  (isWindows &&
    !isArm64 &&
    existsSync(join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "Include")));

// C's stdout is in text mode on Windows: "\r\n" there.
const text = async (stream: ReadableStream<Uint8Array>) => (await stream.text()).replaceAll("\r\n", "\n");
// What `bun build --compile --outfile name` makes.
const executable = (name: string) => (isWindows ? name + ".exe" : name);

async function run(dir: string, args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([text(proc.stdout), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
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

  test.concurrent("a function the process does not have is an error at import, not a crash at call", async () => {
    using dir = tempDir("c-import-undefined", {
      "needs.c":
        "int bun_test_symbol_that_does_not_exist(int);\nint f(int x) { return bun_test_symbol_that_does_not_exist(x); }\n",
      "index.ts": `
        try { await import("./needs.c"); console.log("no error"); }
        catch (e) { console.log(String((e as Error).message)); }
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stdout.trim()).toBe("undefined symbol 'bun_test_symbol_that_does_not_exist'");
    expect(exitCode).toBe(0);
  });

  test.concurrent("C_INCLUDE_PATH adds directories for #include <…>, as it does for gcc, clang and cc()", async () => {
    using dir = tempDir("c-import-include-path", {
      "third_party/include/lib/version.h": "#define LIB_VERSION 7\n",
      "src/use.c": "#include <lib/version.h>\nint version(void) { return LIB_VERSION; }\n",
      "src/index.ts": `import { version } from "./use.c"; console.log(version());`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, C_INCLUDE_PATH: join(String(dir), "third_party/include") },
      cwd: join(String(dir), "src"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([text(proc.stdout), proc.stderr.text(), proc.exited]);
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
      const { stdout, stderr, exitCode } = await run(String(dir), ["hello.c", "one", "two words"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("2 arguments: [one] [two words]\nbye\n");
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

  test.concurrent("what imported C wrote to stdout reaches a pipe when the process ends", async () => {
    using dir = tempDir("c-stdio-flush", {
      "say.c": `#include <stdio.h>\nvoid say(const char *text) { printf("%s", text); }\n`,
      "index.ts": `import { say } from "./say.c"; say(Buffer.from("from C, no newline, no fflush\\0"));`,
    });
    const { stdout, exitCode } = await run(String(dir), ["index.ts"]);
    expect(stdout).toBe("from C, no newline, no fflush");
    expect(exitCode).toBe(0);
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
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    function follow(stream: ReadableStream<Uint8Array>) {
      const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
      let seen = "";
      return async (text: string) => {
        while (!seen.includes(text)) {
          const { value, done } = await reader.read();
          if (done) throw new Error(`stream ended before ${JSON.stringify(text)}; saw ${JSON.stringify(seen)}`);
          seen += value;
        }
      };
    }
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

  test("bun build --watch rebuilds when a header the .c file includes changes", async () => {
    using dir = tempDir("c-build-watch", {
      "value.h": "#define VALUE 1\n",
      "a.c": '#include "value.h"\nint answer(void) { return VALUE; }\n',
      "index.ts": `import { answer } from "./a.c"; console.log("answer = " + answer());`,
    });
    await using builder = Bun.spawn({
      cmd: [bunExe(), "build", "--watch", "--target", "bun", "index.ts", "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    // What the bundle in out/ prints, once there is a bundle that prints `wanted`.
    async function bundlePrints(wanted: string) {
      const bundle = join(String(dir), "out", "index.js");
      for (;;) {
        if (builder.exitCode !== null) throw new Error(`bun build --watch exited: ${await builder.stderr.text()}`);
        if (await Bun.file(bundle).exists()) {
          const { stdout } = await run(String(dir), [bundle]);
          if (stdout === wanted) return stdout;
        }
        await Bun.sleep(25);
      }
    }
    expect(await bundlePrints("answer = 1\n")).toBe("answer = 1\n");
    await Bun.write(join(String(dir), "value.h"), "#define VALUE 7\n");
    expect(await bundlePrints("answer = 7\n")).toBe("answer = 7\n");
    builder.kill();
  });
});

describe.skipIf(!supported)("bundling a .c file", () => {
  const files = {
    "math.c": mathC,
    "index.ts": `import { add, mix } from "./math.c"; console.log(add(40, 2), mix(12345));`,
  };

  test.concurrent("bun build emits the compiled form as an asset and a bundle that loads it", async () => {
    using dir = tempDir("c-bundle", files);
    const build = await run(String(dir), ["build", "index.ts", "--target=bun", "--outdir", "out"]);
    expect(build.stderr).toBe("");
    expect(build.exitCode).toBe(0);

    const out = join(String(dir), "out");
    const assets = [...new Bun.Glob("math-*.c").scanSync(out)];
    expect(assets.length).toBe(1);
    // Not C any more: what the runtime turns into machine code without a parser or headers.
    expect((await Bun.file(join(out, assets[0])).bytes()).subarray(0, 4)).toEqual(new Uint8Array([0x42, 0x49, 0x52, 0]));

    const { stdout, exitCode } = await run(out, ["index.js"]);
    expect(stdout.trim()).toBe("42 2435775735");
    expect(exitCode).toBe(0);
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

  test("bun build --compile of a C file with main() is that program", async () => {
    using dir = tempDir("c-compile-main", {
      "hello.c": /* c */ `
        #include <stdio.h>
        int main(int argc, char **argv) {
          printf("%d:", argc - 1);
          for (int i = 1; i < argc; i++) printf(" [%s]", argv[i]);
          printf("\\n");
          return 7;
        }
      `,
    });
    const build = await run(String(dir), ["build", "--compile", "hello.c", "--outfile", "hello"]);
    expect(build.exitCode).toBe(0);
    await using proc = Bun.spawn({
      cmd: [join(String(dir), executable("hello")), "one", "two words"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([text(proc.stdout), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("2: [one] [two words]\n");
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
      "count.c": '#include "shared.h"\nint counted(void) { return calls + twice(0); }\n',
    });
    const build = await run(String(dir), ["build", "--compile", "main.c", "util.c", "count.c", "--outfile", "prog"]);
    expect(build.stderr).not.toContain("error");
    expect(build.exitCode).toBe(0);
    await using proc = Bun.spawn({
      cmd: [join(String(dir), executable("prog"))],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([text(proc.stdout), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("42 1 2 1\n");
    expect(exitCode).toBe(0);
  });

  test("bun build --compile embeds the compiled form; the executable needs neither the source nor a C parser", async () => {
    using dir = tempDir("c-compile", files);
    const build = await run(String(dir), ["build", "--compile", "index.ts", "--outfile", "app"]);
    expect(build.exitCode).toBe(0);

    using elsewhere = tempDir("c-compile-run", {});
    const exe = join(String(elsewhere), executable("app"));
    await Bun.write(exe, Bun.file(join(String(dir), executable("app"))));
    const { chmodSync } = await import("fs");
    chmodSync(exe, 0o755);

    await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, cwd: String(elsewhere), stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([text(proc.stdout), proc.exited]);
    expect(stdout.trim()).toBe("42 2435775735");
    expect(exitCode).toBe(0);
  });
});
