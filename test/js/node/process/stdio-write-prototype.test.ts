import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

// pino (via sonic-boom) decides whether a stream has been monkey-patched with
// `stream.write !== stream.constructor.prototype.write`. Bun used to install the
// fast-path `write` as an own property on the instance, so that check was true
// for process.stdout/stderr and fast-path WriteStreams, forcing pino onto a slow
// unbatched path. `write` must live on the prototype, like Node.js.
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
