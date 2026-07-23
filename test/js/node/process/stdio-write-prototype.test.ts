import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

// pino/sonic-boom detect a monkey-patched stream via
// `stream.write !== stream.constructor.prototype.write`. `write` must live on
// the prototype (like Node) or pino falls back to a slow unbatched path.
test("WriteStream.prototype.write stays on the prototype (pino fast-path detection)", () => {
  const { stdout, exitCode } = spawnSync({
    cmd: [bunExe(), path.join(import.meta.dir, "stdio-write-on-prototype-fixture.js")],
    stdout: "pipe",
    stdin: null,
    stderr: "inherit",
    env: { ...bunEnv },
  });

  expect(JSON.parse(stdout!.toString())).toEqual({
    stdoutWriteOnPrototype: true,
    stdoutNoOwnWrite: true,
    stderrWriteOnPrototype: true,
    stderrNoOwnWrite: true,
    writeStreamWriteOnPrototype: true,
    writeStreamNoOwnWrite: true,
    wrote: "hello from write stream",
  });
  expect(exitCode).toBe(0);
});
