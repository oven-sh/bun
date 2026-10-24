import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, tempDir } from "harness";

// The collector reads every word of a live stack frame. A word that only a compiled or validated program writes keeps what an
// earlier call left in it, and the frames of the event loop lie at the same addresses in every turn.
// TODO: on Linux arm64 some runs say "alive".
test.todoIf(isLinux && isArm64)(
  "a stream that failed is collected within a few turns of the event loop",
  async () => {
    using dir = tempDir("plain-bun-collects", {
      "main.js": `
      const zlib = require("zlib");
      const { releaseWeakRefs } = require("bun:jsc");
      let ref;
      function isAlive() { return ref.deref() !== undefined; }
      {
        const stream = zlib.createInflate();
        stream.end(Buffer.from("foobar"));
        stream.once("error", () => {
          let turn = 0;
          const step = () => {
            releaseWeakRefs();
            Bun.gc(true);
            if (!isAlive()) return console.log("collected");
            if (++turn > 10) return console.log("alive");
            (turn % 2 ? process.nextTick : setImmediate)(step);
          };
          setImmediate(step);
        });
        ref = new WeakRef(stream);
      }
    `,
    });
    const run = async (env: Record<string, string>) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return exitCode ? `exit code ${exitCode}` : stdout.trim();
    };
    const environments: Record<string, string>[] = [{ BUN_JSC_useJIT: "0" }, {}];
    const [withoutJIT, withJIT] = await Promise.all(
      environments.map(env => Promise.all(Array.from({ length: 4 }, () => run(env)))),
    );
    const collected = Array.from({ length: 4 }, () => "collected");
    expect({ withoutJIT, withJIT }).toEqual({ withoutJIT: collected, withJIT: collected });
  },
  60_000,
);
