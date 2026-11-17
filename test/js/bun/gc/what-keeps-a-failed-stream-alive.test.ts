import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";

// The program of a-failed-stream-is-collected.test.ts. Where the stream is still alive after ten turns, the run says what holds it:
// what-keeps-it-alive.fixture.js. The stale word lies where the frames of one build on one platform put it, so only that build can say.
test.skipIf(!isLinux && !isWindows).each([
  ["whenever", `Buffer.from("foobar")`, ""],
  ["before the module has been loaded", `Buffer.from("foobar")`, "Bun.sleepSync(50);"],
  [
    "in the main loop",
    `Buffer.concat([Buffer.from([0x78, 1]), Buffer.alloc(5 << 22, Buffer.from([0, 0, 0, 255, 255])), Buffer.from([7])])`,
    "",
  ],
])(
  "a stream that failed %s is collected, or the run says what holds it",
  async (when, input, afterwards) => {
    using dir = tempDir("what-keeps-a-failed-stream-alive", {
      "main.js": `
      const zlib = require("zlib");
      const { releaseWeakRefs } = require("bun:jsc");
      const log = console.log;
      console.log = text => {
        log(text);
        if (text === "alive" && process.argv[2]) console.error(require(process.argv[2]).whatKeepsAlive("Inflate"));
      };
      let ref;
      function isAlive() { return ref.deref() !== undefined; }
      {
        const stream = zlib.createInflate();
        stream.end(${input});
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
        ${afterwards}
      }
    `,
    });
    const run = async (env: Record<string, string>, explains: boolean) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js", explains ? join(import.meta.dir, "what-keeps-it-alive.fixture.js") : ""],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (stderr) console.error(`${when}, ${JSON.stringify(env)}:\n${stderr}`);
      return exitCode ? `exit code ${exitCode}` : stdout.trim();
    };
    const environments: Record<string, string>[] = [{ BUN_JSC_useJIT: "0" }, {}];
    const results = await Promise.all(environments.flatMap(env => [run(env, true), run(env, false)]));
    if (results.includes("alive")) console.error(`${when}: ${results.join(" ")}`);
    expect(results).toEqual(results.map(() => expect.stringMatching(/^(collected|alive)$/)));
  },
  60_000,
);
