import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Formatting a stack trace hands one ZigStackFrame per frame to
// Bun__remapStackFramePositions. When the frame's file has an external source
// map (here a `// @bun` file with a sidecar .map, the shape `bun build
// --target=bun --sourcemap` produces), the remap replaces each frame's
// source_url with a freshly allocated string naming the original file. The C++
// callers used to drop their frames without releasing it, so every read of
// `.stack` leaked one string per remapped frame. With a long `sources` entry the
// unfixed leak grows RSS by about FRAMES * SOURCE_NAME_LENGTH bytes per read:
// 44 to 50 MB over ITERATIONS reads on release and debug ASAN builds alike,
// while a fixed build moved by -5 to +3 MB over the same loop on both.

const FRAMES = 10;
// Stays well under the 4096-byte path buffer the remap joins the name into,
// even with the temp dir prefixed.
const SOURCE_NAME_LENGTH = 3000;
const WARMUP = 200;
const ITERATIONS = 1500;
const MAX_GROWTH_MB = 24;
// Formatting WARMUP + ITERATIONS ten-frame stacks takes the child a few seconds
// on debug and ASAN builds.
const CHILD_TIMEOUT_MS = 30_000;

const sourceName = Buffer.alloc(SOURCE_NAME_LENGTH - 3, "s").toString() + ".ts";
// Only present in stack output once the remap swapped the original file name in.
const remappedMarker = Buffer.alloc(64, "s").toString() + ".ts";

// `const error = ...; return error;` keeps every fN on the stack: module code is
// strict, so `return fN()` would be a proper tail call and JSC would drop the frame.
const framesSource =
  [
    "// @bun",
    ...Array.from({ length: FRAMES }, (_, i) => {
      const callee = i === FRAMES - 1 ? 'new Error("boom")' : `f${i + 1}()`;
      return `function f${i}() { const error = ${callee}; return error; }`;
    }),
    "export function makeError() { const error = f0(); return error; }",
    "//# sourceMappingURL=frames.js.map",
  ].join("\n") + "\n";

// One segment per generated line, each advancing one line into sources[0], so
// every frame in frames.js has a mapping and gets remapped.
const framesSourceMap = JSON.stringify({
  version: 3,
  sources: [sourceName],
  sourcesContent: [""],
  names: [],
  mappings: "AAAA" + ";AACA".repeat(framesSource.split("\n").length),
});

// "stack" reads through the default error.stack formatter; "prepareStackTrace"
// reads through the Error.prepareStackTrace path, which remaps into CallSites.
// Both modes count how many frames of each read came back remapped, so a map
// that silently failed to load cannot make the growth check pass vacuously.
const mainSource = /* js */ `
  import { makeError } from "./frames.js";

  const mode = process.argv[2];
  const marker = ${JSON.stringify(remappedMarker)};
  Error.stackTraceLimit = ${FRAMES};
  const rss =
    process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
      ? Bun.unsafe.memoryFootprint
      : process.memoryUsage.rss;

  let remappedFrames = 0;
  if (mode === "prepareStackTrace") {
    Error.prepareStackTrace = (error, callSites) => {
      for (const callSite of callSites) {
        if (callSite.getFileName().includes(marker)) remappedFrames++;
      }
      return "";
    };
  }

  function run(count) {
    for (let i = 0; i < count; i++) {
      const stack = makeError().stack;
      if (mode === "stack") {
        // One marker per remapped frame line; indexOf keeps the count free of
        // per-read garbage that would add noise to the RSS delta.
        for (let at = stack.indexOf(marker); at !== -1; at = stack.indexOf(marker, at + 1)) remappedFrames++;
      }
    }
  }

  run(${WARMUP});
  Bun.gc(true);
  const before = rss();
  run(${ITERATIONS});
  Bun.gc(true);
  const after = rss();

  console.log(JSON.stringify({ remappedFrames, growthMB: Math.round((after - before) / 1024 / 1024) }));
`;

describe.concurrent("error.stack with an external source map does not leak the remapped file names", () => {
  test.each(["stack", "prepareStackTrace"])(
    "%s",
    async mode => {
      using dir = tempDir("external-sourcemap-stack-leak", {
        "frames.js": framesSource,
        "frames.js.map": framesSourceMap,
        "main.js": mainSource,
      });

      // --smol: each read also makes ~FRAMES * SOURCE_NAME_LENGTH bytes of
      // garbage, the default heap sizes how much of it piles up between
      // collections by machine RAM, and what the final Bun.gc(true) just freed
      // is still resident when RSS is sampled. The small heap keeps that residue
      // to a few MB on any machine; the leaked strings are never freed at all.
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "main.js", mode],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { remappedFrames, growthMB } = JSON.parse(stdout);
      expect(remappedFrames).toBe((WARMUP + ITERATIONS) * FRAMES);
      expect(growthMB, `RSS grew by ${growthMB} MB over ${ITERATIONS} .stack reads`).toBeLessThan(MAX_GROWTH_MB);
    },
    CHILD_TIMEOUT_MS,
  );
});
