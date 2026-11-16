import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";

// main.js is the program of a-failed-stream-is-collected.test.ts, to the letter, and it runs as it does there. Whether its stream stays
// alive is a race: the error comes while the entry point still loads, or in the loop. in-a-turn.js starts the stream in a turn of the
// loop, which takes the race away. Where a stream is still alive after ten turns, the run says what holds it:
// what-keeps-it-alive.preload.js. The stale word lies where the frames of one build on one platform put it, so only that build can say.
// Not concurrent with the test below: eight processes run at once here, as in that file, and no more.
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
      // What a run that did not end well printed is part of what failed: the report of another run does not stand for it.
      for (const { stdout, stderr, exitCode } of runs.flat())
        expect({ stdout, exitCode, stderr: exitCode ? stderr : "" }).toEqual({
          stdout: expect.stringMatching(/^(collected|alive)$/),
          exitCode: 0,
          stderr: "",
        });
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
          console.log(whatKeepsAlive("Held"));
          return 1;
        }
      }
      JSON.stringify(new Held());
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", join(import.meta.dir, "what-keeps-it-alive.fixture.js")],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // The word alone is not enough: the line has to name the frame that holds it, or the frame records above it.
    const frames = isWindows
      ? /in the frame of \S+\+0x[0-9a-f]+, 0x[0-9a-f]+ above its stack pointer/
      : /records below: .*\| records above, each the caller of the one before: \+0x[0-9a-f]+ \S+\+0x[0-9a-f]+/;
    expect({ stdout, exitCode }).toEqual({
      stdout: expect.stringMatching(
        new RegExp(/ \(Held\) lies at 0x[0-9a-f]+, 0x[0-9a-f]+ below the end of the stack \| /.source + frames.source),
      ),
      exitCode: 0,
    });
  },
);
