import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, MAX_PATH_BYTES, tempDir, withoutAsanQuarantine } from "harness";
import { join } from "node:path";

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
  const rss = process.memoryUsage.rss;

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

// While source maps are on, a module that names a source map of its own has a
// record in the source map table, with a copy of the URL of that map. The first
// stack that needs the map adds the parsed map to the record. A load of the same
// path puts a new record in the place of the one from the load before, and has
// to free that one. With a `data:` URL of INLINE_MAP_URL_LENGTH bytes, the URLs
// of RELOADS records are 87 MB. On a debug ASAN build, this loop grew RSS by
// 113 MB when a debugger skipped the release of each replaced record, and by 11
// to 12 MB when nothing did. The loop takes the child several seconds on that
// build.
const INLINE_MAP_URL_LENGTH = 256 * 1024;
const RELOAD_WARMUP = 50;
const RELOADS = 350;
const MAX_RELOAD_GROWTH_MB = isASAN || isDebug ? 48 : 32;

// `loads` counts the loads that made the module anew. `mapped` counts the ones
// whose stack is in the original file, which it only is once the map of that
// load was read and parsed.
const reloadSource = /* js */ `
  const path = require.resolve("./lib.js");
  process.setSourceMapsEnabled(true);
  const rss = process.memoryUsage.rss;

  let loads = 0;
  let mapped = 0;
  let previous;
  function load(count) {
    for (let i = 1; i <= count; i++) {
      delete require.cache[path];
      const lib = require(path);
      if (lib !== previous) loads++;
      previous = lib;
      try {
        lib.boom();
      } catch (error) {
        if (error.stack.includes("lib.ts:2:1")) mapped++;
      }
      if (i % 50 === 0) Bun.gc(true);
    }
  }

  load(${RELOAD_WARMUP});
  Bun.gc(true);
  const before = rss();
  load(${RELOADS});
  Bun.gc(true);
  const after = rss();

  console.log(JSON.stringify({ loads, mapped, growthMB: Math.round((after - before) / 1024 / 1024) }));
`;

test.concurrent(
  "a load of a module with an inline source map frees the record of the load before it",
  async () => {
    const map = (sourcesContent: string) =>
      JSON.stringify({
        version: 3,
        sources: ["lib.ts"],
        sourcesContent: [sourcesContent],
        names: [],
        mappings: "AAAA;AACA;AACA",
      });
    const prefix = "data:application/json;base64,";
    // base64 makes four bytes of every three.
    const padding = Math.floor(((INLINE_MAP_URL_LENGTH - prefix.length) * 3) / 4) - map("").length;
    const url = prefix + Buffer.from(map(Buffer.alloc(padding, "x").toString())).toString("base64");
    using dir = tempDir("inline-sourcemap-reload-leak", {
      "lib.js": `exports.boom = function boom() {\n  throw new Error("boom");\n};\n//# sourceMappingURL=${url}\n`,
      "main.cjs": reloadSource,
    });

    // ASAN's quarantine keeps every freed record resident, which is what a leak does too.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "main.cjs"],
      cwd: String(dir),
      env: withoutAsanQuarantine(bunEnv),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { loads, mapped, growthMB } = JSON.parse(stdout);
    expect({ loads, mapped }).toEqual({ loads: RELOAD_WARMUP + RELOADS, mapped: RELOAD_WARMUP + RELOADS });
    expect(growthMB, `RSS grew by ${growthMB} MB over ${RELOADS} loads`).toBeLessThan(MAX_RELOAD_GROWTH_MB);
  },
  CHILD_TIMEOUT_MS,
);

// A frame's path is the `sources` entry joined onto the file's directory. Without `sourcesContent`, the source preview
// for an uncaught error reads that path from disk.
test("prints the stack trace when a `sources` entry is longer than a path buffer", async () => {
  const sourceName = Buffer.alloc(MAX_PATH_BYTES + 104, "x").toString() + ".ts";
  const code = `// @bun\nfunction t() {\n  return new Error("LONGSRC");\n}\nthrow t();\n//# sourceMappingURL=entry.js.map\n`;
  using dir = tempDir("sourcemap-long-source", {
    "entry.js": code,
    "entry.js.map": JSON.stringify({
      version: 3,
      sources: [sourceName],
      sourcesContent: [""],
      names: [],
      mappings: "AAAA" + ";AACA".repeat(code.split("\n").length - 1),
    }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain("LONGSRC");
  expect(stderr).toContain(`at t (${join(String(dir), sourceName)}:`);
  expect(exitCode).toBe(1);
});
