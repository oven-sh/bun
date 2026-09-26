import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";
import { runInNewContext } from "node:vm";

test("can get sourceURL from eval inside node:vm", () => {
  try {
    runInNewContext(
      `
throw new Error("hello");
//# sourceURL=hellohello.js
`,
      {},
    );
  } catch (e: any) {
    var err: Error = e;
  }

  expect(err!.stack!.replaceAll(import.meta.path, "<this-url>")).toMatchSnapshot();
});

test("can get sourceURL inside node:vm", () => {
  const err = runInNewContext(
    `

function hello() {
    return Bun.inspect(new Error("hello"));
}

hello();

//# sourceURL=hellohello.js
`,
    { Bun },
  );

  expect(err.replaceAll(import.meta.path, "<this-url>")).toMatchSnapshot();
});

test("eval sourceURL is correct", () => {
  const err = eval(
    `

function hello() {
    return Bun.inspect(new Error("hello"));
}

hello();

//# sourceURL=hellohello.js
`,
  );
  expect(err.replaceAll(import.meta.path, "<this-url>")).toMatchSnapshot();
});

const CANARY = "SECRET_CANARY_DO_NOT_LEAK_8f2a";

// The error printer reads a frame's source file from disk for a code-frame
// excerpt. A `//# sourceURL` directive, or a node:vm `filename`, lets the code
// that throws choose that source URL. The printer must not open a file the
// module loader never loaded.
describe.concurrent("error printer does not read attacker-named source files", () => {
  for (const via of ["sourceURL", "filename"] as const) {
    for (const caught of [true, false]) {
      for (const nul of [false, true]) {
        const label = `${via}, ${caught ? "caught" : "uncaught"}${nul ? ", interior NUL in the path" : ""}`;
        test(`vm code does not leak a named file's contents (${label})`, async () => {
          using dir = tempDir("vm-sourceurl-leak", {
            "secret.txt": CANARY + "\n",
            "run.mjs": `
              import * as vm from "node:vm";
              const target = process.env.CANARY_PATH + ${JSON.stringify(nul ? "\0.js" : "")};
              const code = 'function f(){ throw new Error("boom") }; f()' ${
                via === "sourceURL" ? `+ '\\n//# sourceURL=' + target` : ""
              };
              const options = { filename: ${via === "filename" ? "target" : '"sandbox.js"'} };
              ${
                caught
                  ? `try { vm.runInNewContext(code, {}, options); } catch (e) { console.error(e); }`
                  : `vm.runInNewContext(code, {}, options);`
              }
            `,
          });

          await using proc = Bun.spawn({
            cmd: [bunExe(), path.join(String(dir), "run.mjs")],
            env: { ...bunEnv, CANARY_PATH: path.join(String(dir), "secret.txt") },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          const output = stdout + stderr;

          // The error is still reported.
          expect(output).toContain("boom");
          // The file's contents are never shown.
          expect(output).not.toContain(CANARY);
          // An interior NUL in the name must not crash the printer. An
          // uncaught error exits 1, a caught one exits 0.
          expect(exitCode).toBe(caught ? 0 : 1);
        });
      }
    }
  }
});

// Frames parsed back out of an already-materialized `error.stack` are the
// gated path. A loaded module, an original source named by a loaded module's
// source map, and a file embedded in a compiled executable must keep their
// code frame there.
describe.concurrent("a loaded module still shows its source code frame", () => {
  const app = `function doWork(): void {
  throw new Error("real module error");
}
try {
  doWork();
} catch (e) {
  void (e as Error).stack;
  console.error(e);
}
`;

  async function run(cmd: string[], cwd: string) {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { output: stdout + stderr, exitCode };
  }

  test("run from source", async () => {
    using dir = tempDir("vm-sourceurl-real", { "app.ts": app });
    const { output, exitCode } = await run([bunExe(), "app.ts"], String(dir));
    expect(output).toContain(`throw new Error("real module error");`);
    expect(output).toContain("app.ts:2:");
    expect(exitCode).toBe(0);
  });

  test("bundled with an external source map", async () => {
    using dir = tempDir("vm-sourceurl-bundled", { "src/app.ts": app });
    const build = await run(
      [bunExe(), "build", "--target=bun", "--sourcemap=external", "--outdir=dist", "src/app.ts"],
      String(dir),
    );
    expect(build.exitCode).toBe(0);
    const { output, exitCode } = await run([bunExe(), "dist/app.js"], String(dir));
    // The frame names the original `src/app.ts`, which the map points at.
    expect(output).toContain(`throw new Error("real module error");`);
    expect(output).toContain(`${path.join("src", "app.ts")}:2:`);
    expect(exitCode).toBe(0);
  });

  test("compiled executable", async () => {
    using dir = tempDir("vm-sourceurl-compiled", { "app.ts": app });
    const exe = path.join(String(dir), process.platform === "win32" ? "app.exe" : "app");
    const build = await run([bunExe(), "build", "--compile", "app.ts", "--outfile", exe], String(dir));
    expect(build.exitCode).toBe(0);
    const { output, exitCode } = await run([exe], String(dir));
    expect(output).toContain(`throw new Error("real module error");`);
    expect(exitCode).toBe(0);
  });
});
