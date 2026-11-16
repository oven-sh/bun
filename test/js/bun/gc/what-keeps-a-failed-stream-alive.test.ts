import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";

const fixture = join(import.meta.dir, "what-keeps-it-alive.fixture.js");

// The program of a-failed-stream-is-collected.test.ts. Where the stream is still alive after ten turns, the run says what holds it:
// what-keeps-it-alive.fixture.js. The stale word lies where the frames of one build on one platform put it, so only that build can say.
// The run says it line by line on its own stderr, so a run that ends early has said what it knew.
test.skipIf(!isLinux && !isWindows)(
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
            if (++turn > 10) {
              console.log("alive");
              console.error(process.argv[3]);
              return require(process.argv[2]).whatKeepsAlive("Inflate", line => console.error(line));
            }
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
          cmd: [bunExe(), "main.js", fixture, `${JSON.stringify(env)}, run ${turn + 1}:`],
          cwd: String(dir),
          env: { ...bunEnv, ...env },
          stdout: "pipe",
          stderr: "inherit",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect({ stdout: stdout.trim(), exitCode }).toEqual({
          stdout: expect.stringMatching(/^(collected|alive)$/),
          exitCode: 0,
        });
      }
    }
  },
  60_000,
);

// What the fixture does where a stream stays alive runs nowhere else. JSON.stringify() holds the object while its toJSON() runs, so
// the address of the object lies in a live frame, and the fixture has to find it there. On Windows it reads the stack with bun:ffi.
test.skipIf(!isLinux && !(isWindows && !isArm64))(
  "the fixture finds the word of the stack that holds an object",
  async () => {
    using dir = tempDir("what-keeps-it-alive", {
      "main.js": `
      const { whatKeepsAlive } = require(process.argv[2]);
      class Held {
        toJSON() {
          // On Windows each line also goes to stderr at once: the frames and their names are only checked by eye so far.
          whatKeepsAlive("Held", line => {
            console.log(line);
            if (process.platform === "win32") console.error(line);
          });
          return 1;
        }
      }
      JSON.stringify(new Held());
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", fixture],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({
      stdout: expect.stringMatching(/ \(Held\) lies at 0x[0-9a-f]+, 0x[0-9a-f]+ below the end of the stack \| /),
      exitCode: 0,
    });
  },
);
