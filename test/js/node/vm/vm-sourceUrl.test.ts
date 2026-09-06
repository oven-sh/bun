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

test.concurrent("a real module still shows its source code frame", async () => {
  using dir = tempDir("vm-sourceurl-real", {
    "app.ts": `function doWork(): void {\n  throw new Error("real module error");\n}\ndoWork();\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(String(dir), "app.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("real module error");
  // The original source line is read from disk and shown as the code frame.
  expect(stderr).toContain(`throw new Error("real module error");`);
  expect(exitCode).not.toBe(0);
});
