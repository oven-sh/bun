import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { spawnSync as cpSpawnSync } from "node:child_process";

describe("spawn with empty", () => {
  for (const [stdin, label] of [
    [new ArrayBuffer(0), "ArrayBuffer"],
    [new Uint8Array(0), "Uint8Array"],
    [new Blob([]), "Blob"],
  ] as const) {
    test(label + " for stdin", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [exited, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
      expect(exited).toBe(0);
      expect(stdout).toBeEmpty();
      expect(stderr).toBeEmpty();
    });
  }
});

// An empty stdin buffer should hand the child the same fd type as a non-empty
// one (a pipe/socket on macOS+Windows, a memfd on Linux), not /dev/null or NUL.
// Node's spawnSync({input: Buffer.alloc(0)}) never gives the child a character
// device on any platform.
describe("empty buffer stdin is not the null device", () => {
  const probe =
    `const fs = require("fs"); let n = 0;` +
    `process.stdin.on("data", d => (n += d.length));` +
    `process.stdin.on("end", () =>` +
    `  console.log(JSON.stringify({ chr: fs.fstatSync(0).isCharacterDevice(), n })));`;

  for (const mk of [() => new ArrayBuffer(0), () => new Uint8Array(0), () => Buffer.alloc(0)]) {
    test(`Bun.spawnSync stdin: ${mk().constructor.name}`, () => {
      const r = Bun.spawnSync({
        cmd: [bunExe(), "-e", probe],
        stdin: mk(),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });
      expect(r.stderr.toString()).toBe("");
      expect(JSON.parse(r.stdout.toString())).toEqual({ chr: false, n: 0 });
      expect(r.exitCode).toBe(0);
    });

    test.concurrent(`Bun.spawn stdin: ${mk().constructor.name}`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", probe],
        stdin: mk(),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ chr: false, n: 0 });
      expect(exitCode).toBe(0);
      expect(proc.stdin).toBeUndefined();
    });
  }

  test("child_process.spawnSync input: Buffer.alloc(0)", () => {
    const r = cpSpawnSync(bunExe(), ["-e", probe], { input: Buffer.alloc(0), env: bunEnv });
    expect(r.stderr.toString()).toBe("");
    expect(JSON.parse(r.stdout.toString())).toEqual({ chr: false, n: 0 });
    expect(r.status).toBe(0);
  });
});
