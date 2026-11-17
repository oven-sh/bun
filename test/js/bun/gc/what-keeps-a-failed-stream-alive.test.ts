import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { parseSymbolMap } from "../../../../scripts/orderfile/windows-symbols";

let listing: ReturnType<typeof parseSymbolMap> | undefined;
/** In CI the names for a Windows executable are in the archive that it came from. */
async function withNames(report: string) {
  const archive = dirname(bunExe()) + ".zip";
  if (!report.includes("exe+0x") || !existsSync(archive)) return report;
  const tar = join(process.env.SystemRoot!, "System32", "tar.exe");
  listing ??= parseSymbolMap(await Bun.$`${tar} -xOf ${archive} ${"*/bun-profile.map"}`.text());
  const { imageBase, symbols } = listing;
  return report.replace(/exe\+0x([0-9a-f]+)/g, (place, offset) => {
    const address = imageBase + parseInt(offset, 16);
    let nearest = symbols[0];
    for (const symbol of symbols) if (symbol[0] <= address && symbol[0] > nearest[0]) nearest = symbol;
    return `${place} ${nearest[1].slice(0, 160)}+0x${(address - nearest[0]).toString(16)}`;
  });
}

// The program of a-failed-stream-is-collected.test.ts. Where the stream is still alive after ten turns, the run says what holds it:
// what-keeps-it-alive.fixture.js. The stale word lies where the frames of one build on one platform put it, so only that build can say.
test.skipIf(!isLinux && !isWindows).each([
  ["at once", `Buffer.from("foobar")`],
  [
    "behind 20 MB of empty blocks",
    `Buffer.concat([Buffer.from([0x78, 1]), Buffer.alloc(5 << 22, Buffer.from([0, 0, 0, 255, 255])), Buffer.from([7])])`,
  ],
])(
  "a stream that failed %s is collected, or the run says what holds it",
  async (when, input) => {
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
      if (stderr) console.error(`${when}, ${JSON.stringify(env)}:\n${await withNames(stderr)}`);
      return exitCode ? `exit code ${exitCode}` : stdout.trim();
    };
    const environments: Record<string, string>[] = [{ BUN_JSC_useJIT: "0" }, {}];
    const results = await Promise.all(environments.flatMap(env => [run(env, true), run(env, false)]));
    if (results.includes("alive")) console.error(`${when}: ${results.join(" ")}`);
    expect(results).toEqual(results.map(() => expect.stringMatching(/^(collected|alive)$/)));
  },
  60_000,
);
