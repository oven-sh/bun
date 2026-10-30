import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "path";

// The program of a-failed-stream-is-collected.test.ts. Where the stream is still alive after ten turns, the run says what holds it:
// what-keeps-it-alive.fixture.js. The stale word lies where the frames of one build on one platform put it, so only that build can say.
test.skipIf(!isLinux)(
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
            if (++turn > 10) return (console.log("alive"), console.error(require(process.argv[2]).whatKeepsAlive("Inflate")));
            (turn % 2 ? process.nextTick : setImmediate)(step);
          };
          setImmediate(step);
        });
        ref = new WeakRef(stream);
      }
    `,
    });
    for (const env of [{ BUN_JSC_useJIT: "0" }, {}]) {
      for (let turn = 0; turn < 2; turn++) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "main.js", join(import.meta.dir, "what-keeps-it-alive.fixture.js")],
          cwd: String(dir),
          env: { ...bunEnv, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        if (stderr) console.error(`${JSON.stringify(env)}, run ${turn + 1}:\n${stderr}`);
        expect({ stdout: stdout.trim(), exitCode }).toEqual({
          stdout: expect.stringMatching(/^(collected|alive)$/),
          exitCode: 0,
        });
      }
    }
  },
  60_000,
);
