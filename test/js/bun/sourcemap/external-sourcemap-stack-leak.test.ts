import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, MAX_PATH_BYTES, tempDir } from "harness";
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

// A collection formats the stack of an Error that nothing has read yet once a function in one of its frames is dead.
// For a frame in a `// @bun` file that is the first use of the file's source map, so the map's JSON is parsed inside the
// collection, on top of whatever the JS thread was doing when it allocated. Here that is the conversion of a parsed
// data file into a JS value, which reads AST nodes out of the thread's store. The map parse used to put its own nodes
// in that store and rewind it, and the next map's nodes then went over the first nodes of the data file: the value
// came back with keys missing or wrong and exit code 0, or the process crashed.
const GC_MODULES = 4;
// The first value is larger than what the heap may grow by before it is collected, so the collection starts in the
// middle of the conversion. The nodes of the small values after it are the next ones in the store.
const GC_BIG_LENGTH = 4 * 1024 * 1024;
const GC_SMALL = 40;

const gcBig = Buffer.alloc(GC_BIG_LENGTH, "b").toString();
const gcSmall = Array.from({ length: GC_SMALL }, (_, i) => "value-" + String(i).padStart(4, "0"));
const gcPairs = (pair: (key: string, value: string) => string, separator: string) =>
  [pair("big", gcBig), ...gcSmall.map((value, i) => pair(`key${i}`, value))].join(separator);
const quoted = JSON.stringify;

const gcDataFiles: Record<string, () => string> = {
  "data.jsonc": () => `// a comment\n{\n${gcPairs((key, value) => `${quoted(key)}: ${quoted(value)}`, ",\n")},\n}\n`,
  "pkg/package.json": () => `{ ${gcPairs((key, value) => `${quoted(key)}: ${quoted(value)}`, ", ")} }`,
  "data.xml": () => `<root>\n${gcPairs((key, value) => `<${key}>${value}</${key}>`, "\n")}\n</root>\n`,
  "data.toml": () => `${gcPairs((key, value) => `${key} = ${quoted(value)}`, "\n")}\n`,
  "data.yaml": () => `${gcPairs((key, value) => `${key}: ${quoted(value)}`, "\n")}\n`,
  "data.json5": () => `{\n${gcPairs((key, value) => `${key}: ${quoted(value)}`, ",\n")},\n}\n`,
};

const gcFixture: Record<string, string> = {
  "main.cjs": /* js */ `
    const [how, file] = process.argv.slice(2);
    (async () => {
      // A collected heap, and little is allocated from here to the load: the next collection is the one that the
      // first value of the file brings on.
      Bun.gc(true);
      const errors = [];
      for (let i = 0; i < ${GC_MODULES}; i++) errors.push(require("./m" + i + ".js").make());

      let data = how === "import" ? (await import(file)).default : require(file);
      // A stack that a collection formatted during the load is a string by now. One that it did not format is
      // formatted by this, and is not counted: the load no longer does what this test is for.
      Error.prepareStackTrace = () => "no collection formatted this stack";
      let remapped = 0;
      for (let i = 0; i < ${GC_MODULES}; i++) if (errors[i].stack.includes("m" + i + ".ts:5:3")) remapped++;

      data = data.root ?? data;
      let intact = 0;
      for (let i = 0; i < ${GC_SMALL}; i++) if (data["key" + i] === "value-" + String(i).padStart(4, "0")) intact++;
      console.log(JSON.stringify({ keys: Object.keys(data).length, big: data.big?.length, intact, remapped }));
    })();
  `,
};
for (let i = 0; i < GC_MODULES; i++) {
  // `inner` is dead once `make` returns, and the Error holds its frame: the next collection formats the stack.
  gcFixture[`m${i}.js`] =
    `// @bun\nexport function make() { return (function inner() { const error = new Error("e${i}"); return error; })(); }\n//# sourceMappingURL=m${i}.js.map\n`;
  // Line 2 of the module is line 5, column 3 of its source.
  gcFixture[`m${i}.js.map`] = JSON.stringify({
    version: 3,
    sources: [`m${i}.ts`],
    sourcesContent: [""],
    names: [],
    mappings: ";AAIE",
  });
}

describe.concurrent("a source map that a collection parses leaves the AST store of the thread as it is", () => {
  test.each([
    ...Object.keys(gcDataFiles).map(file => ["require", file]),
    // One file of each kind of tree: the rows of the JSON parser, and nodes.
    ["import", "data.jsonc"],
    ["import", "data.toml"],
  ])("%s of %s", async (how, file) => {
    using dir = tempDir("sourcemap-gc-data", { ...gcFixture, [file]: gcDataFiles[file]() });
    // --smol: the heap may grow by 1 MB before it is collected. Without a concurrent collector the collection is over
    // inside the allocation that starts it. A concurrent one can end after the load, which is short from there.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "main.cjs", how, `./${file}`],
      cwd: String(dir),
      env: { ...bunEnv, BUN_JSC_useConcurrentGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ keys: GC_SMALL + 1, big: GC_BIG_LENGTH, intact: GC_SMALL, remapped: GC_MODULES }),
      stderr: "",
      exitCode: 0,
    });
  });
});
