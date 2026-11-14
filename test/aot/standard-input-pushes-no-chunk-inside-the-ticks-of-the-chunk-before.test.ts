// A compiled program builds process.stdin from the second text of getStdinStream
// (src/js/ahead-of-time/builtins/ProcessObjectInternals.ts). Like the first text, it tells the source of
// `Bun.stdin.stream()` that a Node stream reads it: a chunk that a pull answers inside the call is pushed inside the
// nextTicks of the chunk before, and a loop of `await once(process.stdin, "data")` misses it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { patterned, runWithPrefilledStdin } from "../js/node/process/stdin/prefilled-stdin";
import { built, slot, spawned } from "./harness/commands";
import { test } from "./supported";

const fixture = join(import.meta.dir, "..", "js", "node", "process", "stdin", "once-data-fixture.js");

// Linux only: the pipe that holds three chunks before the program starts takes F_SETPIPE_SZ. A debug build takes half a
// minute to compile the program.
test.skipIf(!isLinux || isDebug)(
  "a loop of once('data') with two nextTicks gets every byte of a pipe that holds three chunks",
  () =>
    slot(async () => {
      using dir = tempDir("aot-stdin-once-data", {});
      const folder = String(dir);
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", fixture, "--outfile", "once-data"], folder, bunEnv),
      );

      const input = patterned(600_000);
      const expected = {
        stdout: JSON.stringify({ bytes: input.length, firstWrongByte: -1, doneAtEnd: input.length }) + "\n",
        stderr: "",
        exitCode: 0,
      };
      expect(await runWithPrefilledStdin([join(folder, "once-data"), "tick", "2"], input)).toEqual(expected);
      expect(await runWithPrefilledStdin([bunExe(), fixture, "tick", "2"], input)).toEqual(expected);
    }),
);
