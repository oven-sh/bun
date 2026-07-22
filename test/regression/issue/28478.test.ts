import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("node:repl", () => {
  test("repl.start is a function", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "const repl = require('node:repl'); console.log(typeof repl.start);"],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("repl.REPLServer is a function", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "const repl = require('node:repl'); console.log(typeof repl.REPLServer);"],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("repl.Recoverable is a class", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "const repl = require('node:repl'); console.log(typeof repl.Recoverable);"],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("repl.REPL_MODE_SLOPPY and REPL_MODE_STRICT are symbols", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const repl = require('node:repl');
         console.log(typeof repl.REPL_MODE_SLOPPY);
         console.log(typeof repl.REPL_MODE_STRICT);`,
      ],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("symbol\nsymbol");
    expect(exitCode).toBe(0);
  });

  test("repl.start with options creates a REPL that evaluates input", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const repl = require('node:repl');
         const { Readable, Writable } = require('node:stream');

         let output = '';
         const input = new Readable({ read() {} });
         const outputStream = new Writable({
           write(chunk, enc, cb) { output += chunk.toString(); cb(); }
         });

         const r = repl.start({ prompt: '$ ', input, output: outputStream, terminal: false });
         input.push('1 + 2\\n');
         input.push(null);

         r.on('close', () => {
           console.log(output.includes('3'));
           console.log(output.includes('$'));
           process.exit(0);
         });`,
      ],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("true\ntrue");
    expect(exitCode).toBe(0);
  });

  test("repl.start returns a REPLServer instance with expected methods", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const repl = require('node:repl');
         const { Readable, Writable } = require('node:stream');

         const input = new Readable({ read() {} });
         const output = new Writable({ write(c, e, cb) { cb(); } });

         const r = repl.start({ prompt: '> ', input, output, terminal: false });

         console.log(r instanceof repl.REPLServer);
         console.log(typeof r.defineCommand);
         console.log(typeof r.displayPrompt);
         console.log(typeof r.clearBufferedCommand);
         console.log(typeof r.context);

         input.push(null);
         r.on('close', () => process.exit(0));`,
      ],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("true\nfunction\nfunction\nfunction\nobject");
    expect(exitCode).toBe(0);
  });

  test("repl.start('$ ') accepts string argument as prompt", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const repl = require('node:repl');
         const { Readable, Writable } = require('node:stream');

         let output = '';
         const input = new Readable({ read() {} });
         const outputStream = new Writable({
           write(chunk, enc, cb) { output += chunk.toString(); cb(); }
         });

         const origStdin = process.stdin;
         const origStdout = process.stdout;
         Object.defineProperty(process, 'stdin', { value: input, configurable: true });
         Object.defineProperty(process, 'stdout', { value: outputStream, configurable: true });

         const r = repl.start('$ ');

         Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
         Object.defineProperty(process, 'stdout', { value: origStdout, configurable: true });

         input.push('42\\n');
         input.push(null);
         r.on('close', () => {
           console.log(output.includes('$ '));
           console.log(output.includes('42'));
           process.exit(0);
         });`,
      ],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("true\ntrue");
    expect(exitCode).toBe(0);
  });

  test("REPLServer can be constructed with new", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { REPLServer } = require('node:repl');
         const { Readable, Writable } = require('node:stream');

         let output = '';
         const input = new Readable({ read() {} });
         const outputStream = new Writable({
           write(chunk, enc, cb) { output += chunk.toString(); cb(); }
         });

         const r = new REPLServer({
           prompt: 'test> ',
           input,
           output: outputStream,
           terminal: false,
         });

         input.push('"hello"\\n');
         input.push(null);
         r.on('close', () => {
           console.log(output.includes("'hello'"));
           process.exit(0);
         });`,
      ],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("true");
    expect(exitCode).toBe(0);
  });

  test("REPL .exit command works", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const repl = require('node:repl');
         const { Readable, Writable } = require('node:stream');

         const input = new Readable({ read() {} });
         const output = new Writable({ write(c, e, cb) { cb(); } });

         const r = repl.start({ prompt: '> ', input, output, terminal: false });
         r.on('exit', () => {
           console.log('exited');
           process.exit(0);
         });
         input.push('.exit\\n');`,
      ],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("exited");
    expect(exitCode).toBe(0);
  });

  test("repl.writer is exported", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "const repl = require('node:repl'); console.log(typeof repl.writer);"],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("function");
    expect(exitCode).toBe(0);
  });
});
