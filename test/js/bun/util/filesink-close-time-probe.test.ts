// TEMPORARY. These are measurements for the description of the pull request, not tests.
// Each one fails on purpose so that its numbers reach the CI output. The file is
// removed before the pull request leaves draft.
import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

async function measure(script: string) {
  using dir = tempDir("filesink-close-time", {});
  const src = `
    const fs = require("node:fs");
    const { join } = require("node:path");
    const dir = ${JSON.stringify(String(dir))};
    const us = ns => Math.round(ns / 100) / 10;
    function stats(samples) {
      samples.sort((a, b) => a - b);
      const at = q => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
      return "n " + samples.length + " p50 " + us(at(0.5)) + " p99 " + us(at(0.99)) + " max " + us(samples[samples.length - 1]) + " us";
    }
    const out = { build: Bun.revision.slice(0, 10), os: require("node:os").release(), arch: process.arch };
    ${script}
    console.log(JSON.stringify(out));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// The close that the fix moves to the JS thread is the synchronous uv_fs_close
// that fs.closeSync() runs. "readOnly" is the same file opened for reading.
it.skipIf(!isWindows)("MEASUREMENT: closeSync() of a file that was just written", async () => {
  const result = await measure(`
    for (const [label, size, n] of [
      ["0 B", 0, 200],
      ["20 B", 20, 200],
      ["64 KiB", 64 * 1024, 200],
      ["1 MiB", 1024 * 1024, 50],
      ["16 MiB", 16 * 1024 * 1024, 5],
    ]) {
      const buf = Buffer.alloc(size, "x");
      const created = [];
      const replaced = [];
      const readOnly = [];
      const same = join(dir, "replaced-" + size);
      for (let i = 0; i < n; i++) {
        const fresh = join(dir, "created-" + size + "-" + i);
        for (const [samples, path] of [
          [created, fresh],
          [replaced, same],
        ]) {
          const fd = fs.openSync(path, "w");
          if (size) fs.writeSync(fd, buf);
          const start = Bun.nanoseconds();
          fs.closeSync(fd);
          samples.push(Bun.nanoseconds() - start);
        }
        const fd = fs.openSync(same, "r");
        const start = Bun.nanoseconds();
        fs.closeSync(fd);
        readOnly.push(Bun.nanoseconds() - start);
        fs.unlinkSync(fresh);
      }
      out[label] = { created: stats(created), replaced: stats(replaced), readOnly: stats(readOnly) };
    }
  `);
  expect(result).toEqual({ stdout: "printed on purpose", stderr: "", exitCode: 0 });
});

// "inEnd" is the time inside an end() call that returns a number. "writeAndEnd"
// is the time from write() to the code after "await end()".
it.skipIf(!isWindows)("MEASUREMENT: end() of a FileSink", async () => {
  const result = await measure(`
    for (const [label, size, n] of [
      ["20 B", 20, 200],
      ["64 KiB", 64 * 1024, 200],
      ["1 MiB", 1024 * 1024, 50],
      ["16 MiB", 16 * 1024 * 1024, 5],
    ]) {
      const buf = Buffer.alloc(size, "x");
      const inEnd = [];
      const writeAndEnd = [];
      const returns = new Set();
      for (let i = 0; i < n; i++) {
        {
          const writer = Bun.file(join(dir, "end-" + size + "-" + (i % 4))).writer();
          writer.write("a");
          await writer.write(buf);
          const start = Bun.nanoseconds();
          const result = writer.end();
          inEnd.push(Bun.nanoseconds() - start);
          returns.add(typeof result);
          await result;
        }
        {
          const writer = Bun.file(join(dir, "await-end-" + size + "-" + (i % 4))).writer();
          const start = Bun.nanoseconds();
          writer.write(buf);
          await writer.end();
          writeAndEnd.push(Bun.nanoseconds() - start);
        }
      }
      out[label] = { returns: [...returns].join(), inEnd: stats(inEnd), writeAndEnd: stats(writeAndEnd) };
    }
  `);
  expect(result).toEqual({ stdout: "printed on purpose", stderr: "", exitCode: 0 });
});

// setImmediate callbacks that run between "write(); end()" and the code after
// "await end()", while a chain of them keeps the loop turning.
it.skipIf(!isWindows)("MEASUREMENT: turns of the loop before the code after await end()", async () => {
  const result = await measure(`
    let count = 0;
    let spinning = true;
    (function spin() {
      count++;
      if (spinning) setImmediate(spin);
    })();
    const turns = [];
    for (let i = 0; i < 1000; i++) {
      const writer = Bun.file(join(dir, "turns-" + (i % 4))).writer();
      writer.write("x");
      const before = count;
      await writer.end();
      turns.push(count - before);
    }
    spinning = false;
    turns.sort((a, b) => a - b);
    out.turns = "n 1000 p50 " + turns[500] + " p99 " + turns[990] + " max " + turns[999];
  `);
  expect(result).toEqual({ stdout: "printed on purpose", stderr: "", exitCode: 0 });
});
