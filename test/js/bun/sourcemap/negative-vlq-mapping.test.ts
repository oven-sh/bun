import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// A `// @bun`-pragma'd file is not re-transpiled, so the sidecar / inline
// source map is parsed as-is when error.stack is formatted. A negative
// relative VLQ delta that takes a running field below zero must be rejected
// as an invalid map (warn + fall back to unmapped positions), not trip the
// `Ordinal::from_zero_based` debug_assert in assertions-enabled builds.

const body =
  `// @bun\n` +
  `function t() {\n` +
  `  throw new Error("NEGVLQ");\n` +
  `}\n` +
  `try { t(); } catch (e) { console.log(String(e.stack).split("\\n")[1].trim()); }\n`;

function makeMap(mappings: string) {
  return JSON.stringify({
    version: 3,
    sources: ["orig.ts"],
    sourcesContent: ["a\nb\nc\n"],
    names: [],
    mappings,
  });
}

describe.concurrent("sourcemap: negative VLQ delta in mappings is rejected, not asserted", () => {
  for (const [field, mappings, errName] of [
    ["generated column", ";;D;", "InvalidGeneratedColumnValue"],
    ["original line", ";;AADA;", "InvalidOriginalLineValue"],
    ["original column", ";;AAAD;", "InvalidOriginalColumnValue"],
  ] as const) {
    test(`external .map: negative ${field}`, async () => {
      using dir = tempDir("negvlq-ext", {
        "entry.js": body + `//# sourceMappingURL=entry.js.map\n`,
        "entry.js.map": makeMap(mappings),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(errName);
      expect(stdout).toContain("at t (");
      expect(stdout).toContain(join(String(dir), "entry.js"));
      expect(exitCode).toBe(0);
    });

    test(`inline data-URL map: negative ${field}`, async () => {
      const b64 = Buffer.from(makeMap(mappings)).toString("base64");
      using dir = tempDir("negvlq-inl", {
        "entry.js": body + `//# sourceMappingURL=data:application/json;base64,${b64}\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(errName);
      expect(stdout).toContain("at t (");
      expect(exitCode).toBe(0);
    });
  }

  test("new module.SourceMap({mappings}) with negative generated column throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { SourceMap } = require("node:module");
         try {
           new SourceMap({ version: 3, sources: ["a"], names: [], mappings: "D" });
           console.log("no-throw");
         } catch (e) {
           console.log("threw:" + String(e.message));
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout: stdout.trim() }).toEqual({
      stderr: "",
      stdout: expect.stringMatching(/^threw:.*generated column/i),
    });
    expect(exitCode).toBe(0);
  });
});
