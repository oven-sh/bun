import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { closeSync, constants, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../../../aot/run-programs";

const settle = `await new Promise(resolve => setTimeout(resolve, 20));`;
const hint = "(Use `EXE --trace-warnings ...` to show where the warning was created)\n";
const normalize = (text: string) =>
  text.replace(/\(node:\d+\)/g, "(node:PID)").replace(/\(Use `[^` ]+ --trace-warnings/g, "(Use `EXE --trace-warnings");

type Case = {
  source: string;
  env?: Record<string, string>;
  shell?: (command: string, folder: string) => string;
  stdout?: string;
  stderr?: string | RegExp;
  file?: string;
  exitCode?: number;
  mayUseInterpreter?: true;
};
const cases: Record<string, Case> = {
  "prints to descriptor 2": {
    source: `process.emitWarning("first"); process.emitWarning("second", "CustomWarning", "W1"); process.emitWarning("third", { detail: "more" }); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr:
      "(node:PID) Warning: first\n" + hint + "(node:PID) [W1] CustomWarning: second\n(node:PID) Warning: third\nmore\n",
  },
  "a listener hears it and it is still printed": {
    source: `process.on("warning", warning => console.log("heard", warning.name, warning.message)); process.emitWarning("both"); ${settle}`,
    stdout: "heard Warning both\n",
    stderr: "(node:PID) Warning: both\n" + hint,
  },
  "NODE_NO_WARNINGS silences the printer, not the event": {
    source: `process.on("warning", warning => console.log("heard", warning.message)); process.emitWarning("quiet"); ${settle}`,
    env: { NODE_NO_WARNINGS: "1" },
    stdout: "heard quiet\n",
    stderr: "",
  },
  "removeAllListeners silences the printer": {
    source: `process.removeAllListeners("warning"); process.emitWarning("nobody"); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr: "",
  },
  "process.stderr.write patched before the first warning": {
    source: `const captured = []; process.stderr.write = chunk => (captured.push(String(chunk)), true); process.emitWarning("captured"); ${settle} console.log(captured.length, captured[0].endsWith("Warning: captured\\n"));`,
    stdout: "2 true\n",
    stderr: "",
  },
  "process.stderr.write patched after the first warning": {
    source: `process.emitWarning("direct"); ${settle} const captured = []; process.stderr.write = chunk => (captured.push(String(chunk)), true); process.emitWarning("captured"); ${settle} console.log(captured.length, captured[0].endsWith("Warning: captured\\n"));`,
    stdout: "1 true\n",
    stderr: "(node:PID) Warning: direct\n" + hint,
  },
  "process.stderr replaced by assignment": {
    source: `process.stderr = { write(chunk) { console.log("replacement", String(chunk).endsWith("Warning: replaced\\n") || String(chunk).startsWith("(Use")); } }; process.emitWarning("replaced"); ${settle}`,
    stdout: "replacement true\nreplacement true\n",
    stderr: "",
  },
  "process.stderr replaced by defineProperty": {
    source: `Object.defineProperty(process, "stderr", { configurable: true, get() { return { write(chunk) { console.log("getter", String(chunk).length > 0); } }; } }); process.emitWarning("replaced"); ${settle}`,
    stdout: "getter true\ngetter true\n",
    stderr: "",
  },
  "process.stderr replaced by defineProperty under a computed name": {
    source: `const name = ["std", "err"].join(""); Object.defineProperty(process, name, { configurable: true, get() { return { write(chunk) { console.log("getter", String(chunk).length > 0); } }; } }); process.emitWarning("replaced"); ${settle}`,
    stdout: "getter true\ngetter true\n",
    stderr: "",
  },
  "process.stderr only read": {
    source: `void process.stderr; process.emitWarning("through the stream"); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr: "(node:PID) Warning: through the stream\n" + hint,
  },
  "every property of process reified": {
    source: `Object.getOwnPropertyNames(process); process.emitWarning("reified"); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr: "(node:PID) Warning: reified\n" + hint,
  },
  "keeps its place among console.error lines": {
    source: `console.error("a"); process.emitWarning("w"); console.error("b"); ${settle} console.error("c"); process.emitWarning("x"); console.error("d"); ${settle} console.error("e");`,
    stderr: "a\nb\n(node:PID) Warning: w\n" + hint + "c\nd\n(node:PID) Warning: x\ne\n",
  },
  "deprecations": {
    source: `process.emitWarning("old", "DeprecationWarning", "DEP0999"); ${settle} process.noDeprecation = true; process.emitWarning("older", "DeprecationWarning", "DEP0998"); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr: "(node:PID) [DEP0999] DeprecationWarning: old\n" + hint,
  },
  "a timer's delay that does not fit, from native code": {
    source: `clearTimeout(setTimeout(() => {}, 2 ** 31)); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr: /^\(node:PID\) TimeoutOverflowWarning: 2147483648 does not fit into a 32-bit signed integer/,
  },
  "too many listeners on an EventEmitter": {
    source: `import { EventEmitter } from "node:events"; const emitter = new EventEmitter(); for (let i = 0; i < 11; i++) emitter.on("custom", () => {}); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr: /^\(node:PID\) MaxListenersExceededWarning: .*11 custom listeners/,
  },
  "text that is not ASCII, and a lone surrogate": {
    source: `process.emitWarning("h\\u00e9llo \\u{1F600} \\ud800 end"); ${settle}`,
    stderr: "(node:PID) Warning: héllo \u{1F600} � end\n" + hint,
  },
  "a message larger than a pipe's buffer": {
    source: `process.emitWarning("x".repeat(300000)); ${settle} console.log("done");`,
    stdout: "done\n",
    stderr: "(node:PID) Warning: " + Buffer.alloc(300000, "x").toString() + "\n" + hint,
    mayUseInterpreter: true,
  },
  "descriptor 2 is /dev/null": {
    source: `process.emitWarning("to a device"); ${settle} console.log("done");`,
    shell: command => `${command} 2>/dev/null`,
    stdout: "done\n",
  },
  "descriptor 2 redirected to a file": {
    source: `process.emitWarning("to a file"); ${settle} console.log("done");`,
    shell: (command, folder) => `exec 2> ${join(folder, "redirected.txt")}; exec ${command}`,
    stdout: "done\n",
    stderr: "",
    file: "(node:PID) Warning: to a file\n" + hint,
  },
  "NODE_REDIRECT_WARNINGS appends to the file": {
    source: `process.emitWarning("first"); ${settle} process.emitWarning("second"); ${settle} console.log("done");`,
    env: { NODE_REDIRECT_WARNINGS: "$FOLDER/redirected.txt" },
    stdout: "done\n",
    stderr: "",
    file: "(node:PID) Warning: first\n" + hint + "(node:PID) Warning: second\n",
  },
  "a patch of fs.appendFileSync made before the first warning sees a redirected warning": {
    source: `import fs from "node:fs"; const original = fs.appendFileSync; fs.appendFileSync = function (path, text) { console.log("the patch saw", JSON.stringify(text.replace(/[0-9]+/, "PID").split(" --trace")[0].replace(/\`.*$/, "EXE"))); return original.apply(this, arguments); }; process.emitWarning("patched"); ${settle} console.log("done");`,
    env: { NODE_REDIRECT_WARNINGS: "$FOLDER/redirected.txt" },
    stdout: 'the patch saw "(node:PID) Warning: patched\\n"\nthe patch saw "(Use EXE"\ndone\n',
    stderr: "",
    file: "(node:PID) Warning: patched\n" + hint,
  },
  "a patch of fs.appendFileSync made after the first warning sees nothing": {
    source: `process.emitWarning("first"); ${settle} const fs = await import("node:fs"); fs.default.appendFileSync = () => console.log("the patch was called"); process.emitWarning("second"); ${settle} console.log("done");`,
    env: { NODE_REDIRECT_WARNINGS: "$FOLDER/redirected.txt" },
    stdout: "done\n",
    stderr: "",
    file: "(node:PID) Warning: first\n" + hint + "(node:PID) Warning: second\n",
  },
  "NODE_REDIRECT_WARNINGS with a path that cannot be opened falls back to descriptor 2": {
    source: `process.emitWarning("fallback"); ${settle} console.log("done");`,
    env: { NODE_REDIRECT_WARNINGS: "$FOLDER/no/such/folder/redirected.txt" },
    stdout: "done\n",
    stderr: "(node:PID) Warning: fallback\n" + hint,
  },
  "descriptor 2 closed": {
    source: `process.emitWarning("to nowhere"); ${settle} console.log("done");`,
    shell: command => `exec 2>&-; exec ${command}`,
    stdout: "done\n",
    stderr: "",
  },
};

async function run(cmd: string[], folder: string, it: Case, extraEnv: Record<string, string>) {
  const command = it.shell ? ["/bin/sh", "-c", it.shell(cmd.map(part => `'${part}'`).join(" "), folder)] : cmd;
  const env = Object.fromEntries(
    Object.entries(it.env ?? {}).map(([name, value]) => [name, value.replace("$FOLDER", folder)]),
  );
  await using proc = Bun.spawn({
    cmd: command,
    cwd: folder,
    env: { ...bunEnv, ...env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (it.stdout !== undefined) expect(stdout).toBe(it.stdout);
  if (typeof it.stderr === "string") expect(normalize(stderr)).toBe(it.stderr);
  else if (it.stderr) expect(normalize(stderr)).toMatch(it.stderr);
  if (it.file !== undefined) expect(normalize(readFileSync(join(folder, "redirected.txt"), "utf8"))).toBe(it.file);
  expect({ signal: proc.signalCode, exitCode }).toEqual({ signal: null, exitCode: it.exitCode ?? 0 });
}

describe.skipIf(isWindows).concurrent("the default warning printer", () => {
  for (const [name, it] of Object.entries(cases)) {
    test(`plain: ${name}`, async () => {
      using folder = tempDir("warning-printer", { "program.mjs": it.source });
      await run([bunExe(), "program.mjs"], String(folder), it, {});
    });
    test.skipIf(!!unsupported)(
      `--aot: ${name}`,
      async () => {
        using folder = tempDir("warning-printer-aot", { "program.mjs": it.source });
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", "--aot", "program.mjs", "--outfile", "program"],
          cwd: String(folder),
          env: bunEnv,
          stdout: "ignore",
          stderr: "pipe",
        });
        expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
          stderr: expect.not.stringMatching(/^error\b/m),
          exitCode: 0,
        });
        await run(
          [join(String(folder), "program")],
          String(folder),
          it,
          it.mayUseInterpreter ? {} : { BUN_JSC_crashIfInterpreterIsUsed: "1" },
        );
      },
      120_000,
    );
  }

  const goesOn = (size: number) =>
    `setTimeout(() => console.log("the timer ran"), 1); process.emitWarning("x".repeat(${size})); await new Promise(resolve => setTimeout(resolve, 30)); console.log("the program went on"); process.exit(0);`;
  const pipes = [
    {
      name: "a pipe that nobody reads does not stop the program: a large warning",
      source: goesOn(1_000_000),
      stdout: "the timer ran\nthe program went on\n",
      exitCode: 0,
    },
    {
      name: "a pipe that nobody reads does not stop the program: a small warning and the pipe is full already",
      source: goesOn(10),
      isFull: true,
      stdout: "the timer ran\nthe program went on\n",
      exitCode: 0,
    },
    {
      name: "a pipe whose reader is gone raises SIGPIPE as often as before",
      source: `process.on("SIGPIPE", () => console.log("SIGPIPE")); process.emitWarning("nobody listens"); ${settle} console.log("done");`,
      isReaderGone: true,
      stdout: "SIGPIPE\nSIGPIPE\nSIGPIPE\ndone\n",
      exitCode: 1,
    },
  ];
  for (const { name, source, isFull, isReaderGone, stdout, exitCode } of pipes) {
    for (const mode of unsupported ? ["plain"] : ["plain", "--aot"]) {
      test(`${mode}: ${name}`, async () => {
        using folder = tempDir("warning-printer-pipe", { "program.mjs": source });
        const cwd = String(folder);
        let cmd = [bunExe(), "program.mjs"];
        if (mode === "--aot") {
          await using build = Bun.spawn({
            cmd: [bunExe(), "build", "--compile", "--aot", "program.mjs", "--outfile", "program"],
            cwd,
            env: bunEnv,
            stdout: "ignore",
            stderr: "pipe",
          });
          expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
            stderr: expect.not.stringMatching(/^error\b/m),
            exitCode: 0,
          });
          cmd = [join(cwd, "program")];
        }
        expect(Bun.spawnSync(["mkfifo", join(cwd, "pipe")]).exitCode).toBe(0);
        const readerThatNeverReads = openSync(join(cwd, "pipe"), constants.O_RDWR | constants.O_NONBLOCK);
        const descriptor2 = openSync(join(cwd, "pipe"), constants.O_WRONLY);
        try {
          if (isFull)
            expect(() => {
              while (true) writeSync(readerThatNeverReads, Buffer.alloc(512, "y"));
            }).toThrow(expect.objectContaining({ code: "EAGAIN" }));
          if (isReaderGone) closeSync(readerThatNeverReads);
          await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: descriptor2 });
          const outcome = await Promise.race([proc.exited, Bun.sleep(30_000).then(() => "it stands still")]);
          expect({ outcome, stdout: outcome === "it stands still" ? "" : await proc.stdout.text() }).toEqual({
            outcome: exitCode,
            stdout,
          });
        } finally {
          closeSync(descriptor2);
          if (!isReaderGone) closeSync(readerThatNeverReads);
        }
      }, 120_000);
    }
  }

  for (const mode of unsupported ? ["plain"] : ["plain", "--aot"]) {
    test(`${mode}: descriptor 2 is a terminal`, async () => {
      using folder = tempDir("warning-printer-terminal", {
        "program.mjs": `process.emitWarning("on a terminal"); ${settle} console.log("done");`,
      });
      const cwd = String(folder);
      let cmd = [bunExe(), "program.mjs"];
      if (mode === "--aot") {
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", "--aot", "program.mjs", "--outfile", "program"],
          cwd,
          env: bunEnv,
          stdout: "ignore",
          stderr: "pipe",
        });
        expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
          stderr: expect.not.stringMatching(/^error\b/m),
          exitCode: 0,
        });
        cmd = [join(cwd, "program")];
      }
      const chunks: Buffer[] = [];
      const closed = Promise.withResolvers<void>();
      const proc = Bun.spawn({
        cmd,
        cwd,
        env: { ...bunEnv, ...(mode === "--aot" ? { BUN_JSC_crashIfInterpreterIsUsed: "1" } : {}) },
        terminal: { data: (_, data) => void chunks.push(Buffer.from(data)), exit: () => closed.resolve() },
      });
      const exitCode = await proc.exited;
      await closed.promise;
      expect(normalize(Buffer.concat(chunks).toString().replaceAll("\r\n", "\n"))).toBe(
        "(node:PID) Warning: on a terminal\n" + hint + "done\n",
      );
      expect(exitCode).toBe(0);
    }, 120_000);
  }

  test("plain: --no-warnings", async () => {
    using folder = tempDir("warning-printer", {
      "program.mjs": `process.emitWarning("quiet"); ${settle} console.log("done");`,
    });
    await run(
      [bunExe(), "--no-warnings", "program.mjs"],
      String(folder),
      { source: "", stdout: "done\n", stderr: "" },
      {},
    );
  });

  test("plain: a node:worker_threads worker prints through its parent", async () => {
    using folder = tempDir("warning-printer", {
      "worker.mjs": `process.emitWarning("in the worker"); ${settle}`,
      "program.mjs": `import { Worker } from "node:worker_threads"; const worker = new Worker(new URL("./worker.mjs", import.meta.url)); await new Promise(resolve => worker.on("exit", resolve)); console.log("done");`,
    });
    await run(
      [bunExe(), "program.mjs"],
      String(folder),
      { source: "", stdout: "done\n", stderr: "(node:PID) Warning: in the worker\n" + hint },
      {},
    );
  });
});
