import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/31470
// node:repl was a stub with no named exports, so `repl.start`, `repl.REPLServer`
// and `repl.Recoverable` were all `undefined`. This broke consumers such as
// ts-node's `ReplService.start`, which calls `(0, repl.start)({...})` and reads
// `.context` off the returned server.

test("node:repl exposes the Node-compatible named exports", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const repl = require("node:repl");
       console.log(JSON.stringify({
         start: typeof repl.start,
         REPLServer: typeof repl.REPLServer,
         Recoverable: typeof repl.Recoverable,
         writer: typeof repl.writer,
         sloppy: typeof repl.REPL_MODE_SLOPPY,
         strict: typeof repl.REPL_MODE_STRICT,
         sloppyIsStrict: repl.REPL_MODE_SLOPPY === repl.REPL_MODE_STRICT,
       }));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    start: "function",
    REPLServer: "function",
    Recoverable: "function",
    writer: "function",
    sloppy: "symbol",
    strict: "symbol",
    sloppyIsStrict: false,
  });
  expect(exitCode).toBe(0);
});

test("repl.start() returns a REPLServer with a .context that evaluates input", async () => {
  // Drives a REPL over in-memory PassThrough streams (as ts-node does) and
  // checks that start() returns a server whose `.context` is populated and that
  // evaluating input produces output.
  using dir = tempDir("repl-start", {
    "index.mjs": `
      import repl from "node:repl";
      import { PassThrough } from "node:stream";

      const input = new PassThrough();
      const output = new PassThrough();

      let out = "";
      output.on("data", chunk => { out += chunk.toString(); });

      const server = repl.start({
        prompt: "> ",
        input,
        output,
        terminal: false,
        useColors: false,
      });

      if (!(server instanceof repl.REPLServer)) throw new Error("start() did not return a REPLServer");
      if (typeof server.context !== "object" || server.context === null) throw new Error("missing context");

      server.on("exit", () => {
        // Strip the echoed prompts so we only assert on the evaluated result.
        const lines = out.split("\\n").map(l => l.replaceAll("> ", "").trim()).filter(Boolean);
        console.log(JSON.stringify(lines));
      });

      input.write("1 + 2\\n");
      input.write(".exit\\n");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toContain("3");
  expect(exitCode).toBe(0);
});

test("repl buffers incomplete input as a multiline command (Recoverable)", async () => {
  using dir = tempDir("repl-multiline", {
    "index.mjs": `
      import repl from "node:repl";
      import { PassThrough } from "node:stream";

      const input = new PassThrough();
      const output = new PassThrough();

      let out = "";
      output.on("data", chunk => { out += chunk.toString(); });

      const server = repl.start({ prompt: "> ", input, output, terminal: false, useColors: false });

      server.on("exit", () => {
        const lines = out.split("\\n").map(l => l.replaceAll("... ", "").replaceAll("> ", "").trim()).filter(Boolean);
        console.log(JSON.stringify(lines));
      });

      // An object literal split across two lines: the first line is incomplete
      // and must be buffered rather than reported as a syntax error.
      input.write("const obj = {\\n");
      input.write("a: 1 };\\n");
      input.write("obj.a\\n");
      input.write(".exit\\n");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const lines = JSON.parse(stdout.trim());
  // No SyntaxError should have been printed, and the final expression evaluates.
  expect(lines.join("\n")).not.toContain("SyntaxError");
  expect(lines).toContain("1");
  expect(exitCode).toBe(0);
});

test("ts-node-style createRepl().start() opens a REPL instead of throwing", async () => {
  // Minimal reproduction of the shape ts-node uses: it does
  // `const repl_1 = require("repl"); (0, repl_1.start)({ input, output, eval, ... })`
  // and then reads `.context`. This used to throw
  // `TypeError: (0, repl_1.start) is not a function`.
  using dir = tempDir("repl-tsnode", {
    "index.mjs": `
      import { createRequire } from "node:module";
      import { PassThrough } from "node:stream";
      const require = createRequire(import.meta.url);
      const repl_1 = require("repl");

      const input = new PassThrough();
      const output = new PassThrough();

      const replService = { stdin: input, stdout: output };
      const server = (0, repl_1.start)({
        prompt: "> ",
        input: replService.stdin,
        output: replService.stdout,
        terminal: false,
        eval: function nodeEval(code, context, file, cb) { cb(null, undefined); },
        useGlobal: true,
      });

      const context = server.context;
      console.log("ok:" + (typeof repl_1.start === "function") + ":" + (context != null));
      server.close();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("is not a function");
  expect(stdout.trim()).toBe("ok:true:true");
  expect(exitCode).toBe(0);
});
