import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// A `// @bun`-pragma'd file runs as-is and its sidecar `.map` is consulted
// when a stack trace is formatted: each frame's display path is the map's
// `sources` entry joined onto the file's directory, and the source preview of
// an uncaught error reads that joined path back from disk when the map has no
// `sourcesContent`. Both joins used to write into fixed-size path buffers with
// no length check, so a long enough `sources` entry aborted the process:
//
//   panic: range end index 4120 out of range for slice of length 4095
//
// 4200 overflows the 4096-byte buffer behind the display path on every
// platform; 1100 only overflows the PATH_MAX-sized buffer the preview reads
// through on macOS (1024 bytes), where the display path still fits.
const nameLengths = [1100, 4200];

const body = `// @bun\nfunction t() {\n  return new Error("LONGSRC");\n}\n`;

function fixture(sourceName: string, sourcesContent: string, tail: string) {
  const code = body + tail + `//# sourceMappingURL=entry.js.map\n`;
  const lineCount = code.split("\n").length;
  return {
    "entry.js": code,
    "entry.js.map": JSON.stringify({
      version: 3,
      sources: [sourceName],
      sourcesContent: [sourcesContent],
      names: [],
      // Line N of entry.js maps to line N of the source.
      mappings: "AAAA" + ";AACA".repeat(lineCount - 1),
    }),
  };
}

async function run(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("external source map whose `sources` entry is longer than a path buffer", () => {
  for (const nameLength of nameLengths) {
    const sourceName = Buffer.alloc(nameLength, "x").toString() + ".ts";

    test(`error.stack is remapped to the joined source path (${nameLength} bytes)`, async () => {
      using dir = tempDir(
        "sourcemap-long-source",
        fixture(sourceName, "", `console.log(t().stack.split("\\n")[1].trim());\n`),
      );
      const { stdout, stderr, exitCode } = await run(String(dir));
      expect(stderr).toBe("");
      expect(stdout).toMatch(/^at t \(.*:3(:\d+)?\)\n$/s);
      expect(stdout).toContain(`at t (${join(String(dir), sourceName)}:`);
      expect(exitCode).toBe(0);
    });

    for (const [label, sourcesContent] of [
      ["without sourcesContent, so the preview tries to read the joined path", ""],
      ["with sourcesContent", "a\nb\nc\nd\ne\nf\n"],
    ] as const) {
      test(`uncaught error is printed with the joined source path, ${label} (${nameLength} bytes)`, async () => {
        using dir = tempDir("sourcemap-long-source-uncaught", fixture(sourceName, sourcesContent, `throw t();\n`));
        const { stdout, stderr, exitCode } = await run(String(dir));
        expect(stdout).toBe("");
        expect(stderr).toContain("LONGSRC");
        expect(stderr).toContain(`at t (${join(String(dir), sourceName)}:`);
        expect(exitCode).toBe(1);
      });
    }
  }
});

// Control for the cases above: when the joined path fits and the file exists,
// the preview is read from it. The source deliberately has an extension bun
// has no loader for: when the read is skipped, bun falls back to loading the
// source path as a module, which for a .js/.ts file would print the same file
// and mask the difference, while for .coffee it prints entry.js instead.
test.concurrent("uncaught error previews the original source read from the joined path", async () => {
  using dir = tempDir("sourcemap-source-preview", {
    ...fixture("original.coffee", "", `throw t();\n`),
    "original.coffee": "ORIGINAL_LINE_1\nORIGINAL_LINE_2\nORIGINAL_LINE_3\nORIGINAL_LINE_4\n",
  });
  const { stdout, stderr, exitCode } = await run(String(dir));
  expect(stdout).toBe("");
  expect(stderr).toContain("ORIGINAL_LINE_3");
  expect(stderr).not.toContain("new Error(");
  expect(stderr).toContain(`at t (${join(String(dir), "original.coffee")}:3`);
  expect(exitCode).toBe(1);
});
