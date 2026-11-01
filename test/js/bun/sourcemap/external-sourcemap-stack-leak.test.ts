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

// `bun build --sourcemap=external` and `--sourcemap=linked` write one debug id into the bundle (`//# debugId=`) and
// into its map (`"debugId"`). A map beside the file that has another id is the map of another build.
// ";;EAIE" maps generated 3:3 to original 5:3 of source 0.
describe.concurrent("the debug id of a // @bun file and of the .map beside it", () => {
  const throwsOnLine3 = `// @bun\nexport function t() {\n  throw new Error("SC");\n}\n`;
  const cjsThrowsOnLine3 = `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {exports.t = function t() {\n  throw new Error("SC");\n};\n})\n`;
  const fileId = "0123456789ABCDEF64756E2164756E21";
  const otherId = "FEDCBA987654321064756E2164756E21";
  const uuid = "01234567-89ab-cdef-6475-6e2164756e21";
  const longId = Buffer.alloc(64, "a").toString();
  const map = (extra: object) =>
    JSON.stringify({
      version: 3,
      sources: ["mapped.ts"],
      sourcesContent: [null],
      names: [],
      mappings: ";;EAIE",
      ...extra,
    });
  const external = (id = fileId) => `//# debugId=${id}\n`;
  const url = (name: string) => `//# sourceMappingURL=${name}.map\n`;

  async function run(files: Record<string, string>, script: string, args: string[]) {
    using dir = tempDir("sourcemap-debug-id", { "main.js": script, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const clean = (text: string) => text.replaceAll(String(dir), "<dir>").replaceAll("\\", "/");
    return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
  }
  // A warning shows the first 64 bytes of an id.
  const shown = (id: string) => (id.length > 64 ? `"${id.slice(0, 64)}"...` : `"${id}"`);
  const refused = (name: string, id = fileId, mapId = otherId) =>
    `warn: Ignoring sourcemap "<dir>/${name}.map": its debugId ${shown(mapId)} is not the debugId ${shown(id)} that "<dir>/${name}" had when it was last loaded\n` +
    "note: positions in this file stay unmapped until Bun loads it again beside a map with the same debugId\n";
  const mapped = "at t (<dir>/mapped.ts:5:3)";
  const frameOf = `const frame = text => text.split("\\n").find(line => line.includes(" at t ")).trim();`;

  test("the map is read unless it has another debug id, and one warning says so", async () => {
    // [name of the file, what follows its code, the map, the id that the file has when the map has another one]
    const rows: [string, (name: string) => string, object, string?][] = [
      ["external.js", () => external(), { debugId: fileId }],
      ["linked.js", name => external() + url(name), { debugId: fileId }],
      ["required-external.cjs", () => external(), { debugId: fileId }],
      ["required-linked.cjs", name => external() + url(name), { debugId: fileId }],
      // The id is a UUID. Tools write it in lower case and with dashes.
      ["uuid-in-map.js", () => external(), { debugId: uuid }],
      ["uuid-in-file.js", () => external(uuid), { debugId: fileId }],
      ["id-of-another-tool.js", name => external("abc_def") + url(name), { debugId: "abc_def" }],
      ["long-id.js", () => external(longId + "1"), { debugId: longId + "1" }],
      ["blank-before-id.js", () => external(" \t" + fileId), { debugId: fileId }],
      // A tool that writes the map again can drop the id.
      ["map-without-id.js", () => external(), {}],
      ["map-with-empty-id.js", name => external() + url(name), { debugId: "" }],
      ["map-id-is-not-a-string.js", () => external(), { debugId: 123 }],
      // A file with no id line has nothing to compare.
      ["file-without-id.js", name => url(name), { debugId: otherId }],
      ["empty-id.js", () => external(""), { debugId: otherId }],
      // An id is one run of ASCII characters with no blank and no quote.
      ["text-after-id.js", () => external(otherId + " text"), { debugId: fileId }],
      ["quoted-id.js", () => external(`"${otherId}"`), { debugId: fileId }],
      ["id-is-not-ascii.js", () => external("caf\u00e9"), { debugId: otherId }],
      // An id line is the last line, or the line above a last `//# sourceMappingURL=` line.
      ["id-above-a-comment.js", () => external(otherId) + "// end\n", { debugId: fileId }],
      ["id-two-lines-above-the-url.js", name => external(otherId) + "// x\n" + url(name), { debugId: fileId }],
      ["indented-id.js", () => "  " + external(otherId), { debugId: fileId }],

      ["other-external.js", () => external(), { debugId: otherId }, fileId],
      ["other-linked.js", name => external() + url(name), { debugId: otherId }, fileId],
      ["required-other-external.cjs", () => external(), { debugId: otherId }, fileId],
      ["required-other-linked.cjs", name => external() + url(name), { debugId: otherId }, fileId],
      ["other-tool.js", name => external("abc_def") + url(name), { debugId: otherId }, "abc_def"],
      ["crlf-external.js", () => external(), { debugId: otherId }, fileId],
      ["crlf-linked.js", name => external() + url(name), { debugId: otherId }, fileId],
      ["no-final-line-end.js", () => external().trimEnd(), { debugId: otherId }, fileId],
      ["blank-before-other-id.js", () => external(" " + fileId), { debugId: otherId }, fileId],
      ["space-after-id.js", () => external(fileId + " \t"), { debugId: otherId }, fileId],
      ["space-after-id-linked.js", name => external(fileId + " \t") + url(name), { debugId: otherId }, fileId],
      ["blank-line-above-the-url.js", name => external() + "\n" + url(name), { debugId: otherId }, fileId],
      // sentry-cli writes the id there.
      ["id-below-the-url.js", name => url(name) + "\n" + external(), { debugId: otherId }, fileId],
      ["long-id-other-end.js", () => external(longId + "1"), { debugId: longId + "2" }, longId + "1"],
      // Characters that are not ASCII above the id line do not hide it, below and above U+00FF.
      [
        "not-ascii-above-id.js",
        () => "/*! Copyright \u00a9 W\u00e4rting \u0100 */\n" + external(),
        { debugId: otherId },
        fileId,
      ],
      // The id line is read at any distance from the end of the file.
      [
        "long-url.js",
        () => external() + `//# sourceMappingURL=https://example.com/${Buffer.alloc(100_000, "a")}.map\n`,
        { debugId: otherId },
        fileId,
      ],
    ];
    const files: Record<string, string> = {};
    for (const [name, tail, mapFields] of rows) {
      const text = (name.endsWith(".cjs") ? cjsThrowsOnLine3 : throwsOnLine3) + tail(name);
      files[name] = name.startsWith("crlf-") ? text.replaceAll("\n", "\r\n") : text;
      files[name + ".map"] = map(mapFields);
    }
    // Each error is printed three times: its stack, then twice with the lines of code around it. The line on stderr
    // shows that the whole warning is there before the program continues.
    const printFrames = `
      ${frameOf}
      for (const file of process.argv.slice(2)) {
        const { t } = file.endsWith(".cjs") ? require("./" + file) : await import("./" + file);
        try {
          t();
        } catch (e) {
          console.log(file + ": " + [frame(e.stack), frame(Bun.inspect(e)), frame(Bun.inspect(e))].join(" | "));
        }
        console.error(file + ": done");
      }
    `;

    const { stdout, stderr, exitCode } = await run(files, printFrames, ["main.js", ...rows.map(([name]) => name)]);
    const expected = rows.map(([name, , mapFields, idOfFile]) => {
      const frame = idOfFile === undefined ? mapped : `at t (<dir>/${name}:3:18)`;
      const warning = idOfFile === undefined ? "" : refused(name, idOfFile, (mapFields as { debugId: string }).debugId);
      return { stdout: `${name}: ${frame} | ${frame} | ${frame}\n`, stderr: `${warning}${name}: done\n` };
    });
    expect({ stdout: stdout.split(/(?<=\n)/), stderr: stderr.split(/(?<=done\n)/) }).toEqual({
      stdout: expected.map(row => row.stdout),
      stderr: expected.map(row => row.stderr),
    });
    expect(exitCode).toBe(0);
  });

  // The loader changes the text of a CommonJS file for a replaced `Module.wrapper`: it swaps the first line and cuts
  // the last 4 characters, which are the end of the id here. The id of that text is not compared.
  test.each([
    ["", ""],
    ["", "\n"],
    ["/*\u0100*/", "\n"],
  ])("the map of a CommonJS bundle is read after Module.wrapper is replaced with %j and %j", async (...wrapper) => {
    const files = {
      "own.cjs": cjsThrowsOnLine3 + external(),
      "own.cjs.map": map({ debugId: fileId }),
      "other.js": throwsOnLine3 + external(),
      "other.js.map": map({ debugId: otherId }),
    };
    const script = `
      ${frameOf}
      require("node:module").wrapper = JSON.parse(process.argv[2]);
      for (const load of [() => require("./own.cjs"), () => import("./other.js")]) {
        try {
          (await load()).t();
        } catch (e) {
          console.log(frame(e.stack));
        }
      }
    `;

    const { stdout, stderr, exitCode } = await run(files, script, ["main.js", JSON.stringify(wrapper)]);
    expect({ stdout, stderr }).toEqual({
      stdout: `${mapped}\nat t (<dir>/other.js:3:18)\n`,
      stderr: refused("other.js"),
    });
    expect(exitCode).toBe(0);
  });

  test("an error that nothing catches has the warning and not the notes about a missing map", async () => {
    const files = {
      "external.js": throwsOnLine3 + "t();\n" + external(),
      "external.js.map": map({ debugId: otherId }),
    };

    const { stdout, stderr, exitCode } = await run(files, "", ["external.js"]);
    expect(stdout).toBe("");
    expect(stderr).toStartWith(refused("external.js"));
    expect(stderr).toContain("at t (<dir>/external.js:3:9)");
    expect(stderr).not.toContain("missing sourcemaps");
    expect(exitCode).toBe(1);
  });

  test("a refused map is not read again for that load of the file, and the next load reads the map", async () => {
    const script = `
      import { writeFileSync } from "node:fs";
      ${frameOf}
      async function frameOfLoad(query) {
        const { t } = await import("./reloaded.js" + query);
        try {
          t();
        } catch (e) {
          return frame(e.stack);
        }
      }
      console.log(await frameOfLoad(""));
      writeFileSync("reloaded.js.map", process.argv[2]);
      console.log(await frameOfLoad(""));
      console.log(await frameOfLoad("?again"));
    `;
    const files = {
      "reloaded.js": throwsOnLine3 + external(),
      "reloaded.js.map": map({ debugId: otherId }),
    };

    const { stdout, stderr, exitCode } = await run(files, script, ["main.js", map({ debugId: fileId })]);
    const unmapped = "at t (<dir>/reloaded.js:3:18)";
    expect({ stdout, stderr }).toEqual({
      stdout: `${unmapped}\n${unmapped}\n${mapped}\n`,
      stderr: refused("reloaded.js"),
    });
    expect(exitCode).toBe(0);
  });

  // The lines of code of an error are read again each time the error is printed: from the map, or else from the source
  // file that the map names. ";;ECIE" maps generated 3:3 to original 5:3 of source 1.
  test.each([
    ["and the source file is not there", {}, "5 | FIRST 5 | at t (<dir>/mapped.ts:5:3)\nat t (<dir>/mapped.ts:5:3)\n"],
    [
      "and the source file is there",
      { "mapped.ts": [1, 2, 3, 4, 5, 6].map(line => `FIRST ${line}\n`).join("") },
      "5 | FIRST 5 | at t (<dir>/mapped.ts:5:3)\n5 | FIRST 5 | at t (<dir>/mapped.ts:5:3)\n",
    ],
  ])(
    "the lines of code do not come from a map that another build wrote while the file runs, %s",
    async (_, source, stdoutOfBoth) => {
      const code = (word: string) => [1, 2, 3, 4, 5, 6].map(line => `${word} ${line}\n`).join("");
      const script = `
      import { writeFileSync } from "node:fs";
      import { t } from "./replaced.js";
      function codeOfError() {
        try {
          t();
        } catch (e) {
          const text = Bun.inspect(e);
          return text.split("\\n").filter(line => / (FIRST|ADDED|OTHER) 5$| at t /.test(line)).map(line => line.trim()).join(" | ");
        }
      }
      console.log(codeOfError());
      writeFileSync("replaced.js.map", process.argv[2]);
      console.log(codeOfError());
    `;
      const files = {
        ...source,
        "replaced.js": throwsOnLine3 + external(),
        "replaced.js.map": map({
          debugId: fileId,
          mappings: ";;ECIE",
          sources: ["other.ts", "mapped.ts"],
          sourcesContent: [code("OTHER"), code("FIRST")],
        }),
      };
      // The other build has one more source, so the source of the frame has another index in its map.
      const ofAnotherBuild = map({
        debugId: otherId,
        mappings: ";;ECIE",
        sources: ["added.ts", "other.ts", "mapped.ts"],
        sourcesContent: [code("ADDED"), code("OTHER"), code("FIRST")],
      });

      const { stdout, stderr, exitCode } = await run(files, script, ["main.js", ofAnotherBuild]);
      expect({ stdout, stderr }).toEqual({ stdout: stdoutOfBoth, stderr: "" });
      expect(exitCode).toBe(0);
    },
  );
});
