import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(source: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("pipe() asks whether its target is process.stdout or process.stderr without making either", async () => {
  expect(
    await run(`
      const fs = require("node:fs"), tty = require("node:tty"), { Readable, Writable } = require("node:stream");
      let made = 0;
      for (const holder of [fs, tty]) {
        const Original = holder.WriteStream;
        holder.WriteStream = function (...given) { made++; return new Original(...given); };
      }
      Readable.from(["x"]).pipe(new Writable({ write(chunk, encoding, done) { done(); } }));
      console.log(made);
    `),
  ).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
});

test.each(["stdout", "stderr"])("pipe() does not end process.%s", async name => {
  const { stdout, stderr, exitCode } = await run(`
      const { Readable } = require("node:stream");
      const target = process.${name};
      Readable.from(["piped\\n"]).on("end", () => setImmediate(() => target.write(String(target.writableEnded) + "\\n"))).pipe(target);
    `);
  expect({ said: name === "stdout" ? stdout : stderr, exitCode }).toEqual({ said: "piped\nfalse\n", exitCode: 0 });
});

test("pipe() does not end a stream that the program has put in the place of process.stdout", async () => {
  expect(
    await run(`
      const { Readable, Writable } = require("node:stream");
      const own = new Writable({ write(chunk, encoding, done) { done(); } });
      const other = new Writable({ write(chunk, encoding, done) { done(); } });
      Object.defineProperty(process, "stdout", { get: () => own, configurable: true });
      Readable.from(["x"]).pipe(own);
      Readable.from(["x"]).pipe(other);
      setTimeout(() => console.error(own.writableEnded, other.writableEnded), 20);
    `),
  ).toEqual({ stdout: "", stderr: "false true\n", exitCode: 0 });
});
