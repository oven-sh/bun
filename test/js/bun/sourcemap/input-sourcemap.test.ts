// When Bun runs a .js file that was produced by another tool (tsc, esbuild,
// swc) and that file carries a `//# sourceMappingURL=` comment, stack traces
// should resolve through that map to the original source positions, the same
// as `node --enable-source-maps`.
//
// https://github.com/oven-sh/bun/issues/2125
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Original source: the positions the stack trace should report.
const original = `\
// leading comment
// another comment
type T = { x: number };

function boom(): never {
  throw new Error("kaboom");
}
function main() {
  boom();
}
main();
`;

// Generated JS laid out like tsc output: the throw moves from original
// index.ts:6:9 to generated index.js:5:11, main()'s boom() call from
// index.ts:9:3 to index.js:8:5, and the top-level main() call from
// index.ts:11:1 to index.js:10:1.
const generated = `\
"use strict";
// leading comment
// another comment
function boom() {
    throw new Error("kaboom");
}
function main() {
    boom();
}
main();
`;

// Source map for the layout above. `node --enable-source-maps` resolves the
// three stack frames to index.ts:6:9, index.ts:9:3, index.ts:11:1. Bun's
// columns differ where JavaScriptCore reports the Error constructor token
// rather than `new` (6:13 vs 6:9), so assertions below check the line only
// for the throw frame.
const mapJson = {
  version: 3,
  file: "index.js",
  sourceRoot: "",
  sources: ["index.ts"],
  names: [],
  mappings:
    ";AAAA;AACA;AAGA,SAAS,IAAI;IACX,MAAM,IAAI,KAAK,CAAC,QAAQ,CAAC,CAAC;AAC5B,CAAC;AACD,SAAS,IAAI;IACX,IAAI,EAAE,CAAC;AACT,CAAC;AACD,IAAI,EAAE,CAAC",
};

function inlineMapUrl(map: object) {
  const b64 = Buffer.from(JSON.stringify(map)).toString("base64");
  return `//# sourceMappingURL=data:application/json;base64,${b64}`;
}

async function run(dir: string, file: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    env: { ...bunEnv, ...extraEnv },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("input //# sourceMappingURL is applied to stack traces", () => {
  test("external .map file", async () => {
    using dir = tempDir("input-sourcemap-external", {
      "index.ts": original,
      "index.js": generated + "//# sourceMappingURL=index.js.map\n",
      "index.js.map": JSON.stringify(mapJson),
      "run.js": `\
try { require("./index.js"); } catch (e) { console.log(e.stack); }
`,
    });

    const { stdout, exitCode } = await run(String(dir), "run.js");
    expect(stdout).toContain(`at boom (${join(String(dir), "index.ts")}:6:`);
    expect(stdout).toContain(`at main (${join(String(dir), "index.ts")}:9:3)`);
    expect(stdout).not.toContain("index.js:");
    expect(exitCode).toBe(0);
  });

  test("inline data: URI", async () => {
    using dir = tempDir("input-sourcemap-inline", {
      "index.ts": original,
      "index.js": generated + inlineMapUrl(mapJson) + "\n",
      "run.js": `\
try { require("./index.js"); } catch (e) { console.log(e.stack); }
`,
    });

    const { stdout, exitCode } = await run(String(dir), "run.js");
    expect(stdout).toContain(`at boom (${join(String(dir), "index.ts")}:6:`);
    expect(stdout).toContain(`at main (${join(String(dir), "index.ts")}:9:3)`);
    expect(stdout).not.toContain("index.js:");
    expect(exitCode).toBe(0);
  });

  test("uncaught error code frame from sourcesContent (original not on disk)", async () => {
    using dir = tempDir("input-sourcemap-uncaught", {
      "index.js": generated + "//# sourceMappingURL=index.js.map\n",
      "index.js.map": JSON.stringify({ ...mapJson, sourcesContent: [original] }),
    });

    const { stderr, exitCode } = await run(String(dir), "index.js");
    // Frame positions
    expect(stderr).toContain(`at boom (${join(String(dir), "index.ts")}:6:`);
    expect(stderr).toContain(`at main (${join(String(dir), "index.ts")}:9:3)`);
    // Code frame shows the original source from sourcesContent
    expect(stderr).toContain(`function boom(): never {`);
    expect(stderr).toContain(`throw new Error("kaboom")`);
    expect(stderr).not.toContain(`"use strict"`);
    expect(exitCode).toBe(1);
  });

  test("uncaught error code frame from original on disk (no sourcesContent)", async () => {
    using dir = tempDir("input-sourcemap-uncaught-disk", {
      "index.ts": original,
      "index.js": generated + "//# sourceMappingURL=index.js.map\n",
      "index.js.map": JSON.stringify(mapJson),
    });

    const { stderr, exitCode } = await run(String(dir), "index.js");
    expect(stderr).toContain(`at boom (${join(String(dir), "index.ts")}:6:`);
    expect(stderr).toContain(`function boom(): never {`);
    expect(stderr).not.toContain(`"use strict"`);
    expect(exitCode).toBe(1);
  });

  test("map without sourcesContent still remaps frames", async () => {
    using dir = tempDir("input-sourcemap-no-content", {
      "index.js": generated + "//# sourceMappingURL=index.js.map\n",
      "index.js.map": JSON.stringify(mapJson),
    });

    const { stderr, exitCode } = await run(String(dir), "index.js");
    expect(stderr).toContain("index.ts:6");
    expect(stderr).toContain("index.ts:9");
    // Original source is unavailable (no sourcesContent, not on disk) so no
    // code frame is shown; the generated file's lines must not leak through.
    expect(stderr).not.toContain("function boom()");
    expect(stderr).not.toContain(`"use strict"`);
    expect(exitCode).toBe(1);
  });

  test("no input map: frames stay at generated positions", async () => {
    using dir = tempDir("input-sourcemap-none", {
      "index.js": generated,
      "run.js": `\
try { require("./index.js"); } catch (e) { console.log(e.stack); }
`,
    });

    const { stdout, exitCode } = await run(String(dir), "run.js");
    expect(stdout).toContain(`at boom (${join(String(dir), "index.js")}:5:`);
    expect(stdout).not.toContain("index.ts");
    expect(exitCode).toBe(0);
  });

  test("map file missing: falls back to generated positions silently", async () => {
    using dir = tempDir("input-sourcemap-missing", {
      "index.js": generated + "//# sourceMappingURL=does-not-exist.js.map\n",
      "run.js": `\
try { require("./index.js"); } catch (e) { console.log(e.stack); }
`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), "run.js");
    expect(stdout).toContain(`at boom (${join(String(dir), "index.js")}:5:`);
    expect(stdout).not.toContain("index.ts");
    expect(stderr).not.toContain("ENOENT");
    expect(exitCode).toBe(0);
  });

  test("sources resolve relative to the map file, not the executed file", async () => {
    // tsc `mapRoot`: map lives under maps/, sources are relative to the map.
    using dir = tempDir("input-sourcemap-mapdir", {
      "src/index.ts": original,
      "dist/index.js": generated + "//# sourceMappingURL=../maps/index.js.map\n",
      "maps/index.js.map": JSON.stringify({ ...mapJson, sources: ["../src/index.ts"] }),
    });

    const { stderr, exitCode } = await run(String(dir), join("dist", "index.js"));
    expect(stderr).toContain(`at boom (${join(String(dir), "src", "index.ts")}:6:`);
    expect(stderr).toContain(`at main (${join(String(dir), "src", "index.ts")}:9:3)`);
    // Code frame read from src/index.ts on disk
    expect(stderr).toContain(`function boom(): never {`);
    expect(exitCode).toBe(1);
  });

  test("map file invalid JSON: warns and falls back to generated positions", async () => {
    using dir = tempDir("input-sourcemap-invalid", {
      "index.js": generated + "//# sourceMappingURL=index.js.map\n",
      "index.js.map": "{ this is not json",
      "run.js": `\
try { require("./index.js"); } catch (e) { console.log(e.stack); }
`,
    });

    const { stdout, stderr, exitCode } = await run(String(dir), "run.js");
    expect(stdout).toContain(`at boom (${join(String(dir), "index.js")}:5:`);
    expect(stdout).not.toContain("index.ts");
    expect(stderr).toContain("Could not decode sourcemap");
    expect(exitCode).toBe(0);
  });
});
