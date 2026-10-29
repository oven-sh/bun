import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// main.js is the program of a-failed-stream-is-collected.test.ts, to the letter, and it runs as it does there. Whether its stream stays
// alive is a race: the error comes while the entry point still loads, or in the loop. in-a-turn.js starts the stream in a turn of the
// loop, which takes the race away. Where a stream is still alive after ten turns, the run says what holds it:
// what-keeps-it-alive.preload.js. The stale word lies where the frames of one build on one platform put it.
test.skipIf(!isLinux && !isMacOS)(
  "a stream that failed is collected, or the run says what holds it",
  async () => {
    using dir = tempDir("what-keeps-a-failed-stream-alive", {
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
      "in-a-turn.js": `
      const zlib = require("zlib");
      const { releaseWeakRefs } = require("bun:jsc");
      let ref;
      function isAlive() { return ref.deref() !== undefined; }
      setImmediate(() => {
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
      });
    `,
    });
    const run = async (program: string, env: Record<string, string>) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--preload", join(import.meta.dir, "what-keeps-it-alive.preload.js"), program],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
    };
    const environments: Record<string, string>[] = [{ BUN_JSC_useJIT: "0" }, {}];
    for (const program of ["main.js", "in-a-turn.js"]) {
      const runs = await Promise.all(
        environments.map(env => Promise.all(Array.from({ length: 4 }, () => run(program, env)))),
      );
      for (const [at, env] of environments.entries()) {
        console.error(`${program} ${JSON.stringify(env)}: ${runs[at].map(({ stdout }) => stdout).join(", ")}`);
        const report = runs[at].find(({ stderr }) => stderr)?.stderr;
        if (report) console.error(report);
      }
      for (const { stdout, exitCode } of runs.flat())
        expect({ stdout, exitCode }).toEqual({ stdout: expect.stringMatching(/^(collected|alive)$/), exitCode: 0 });
    }
  },
  60_000,
);
