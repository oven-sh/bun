// `is_string()` accepts String *objects*, so a `new String("js")` loader with a
// hostile `toString()` can detach the code buffer during loader coercion.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

const fixture = `
const N = 1 << 20;
const enc = new TextEncoder();
const fill = (u, s) => { u.fill(0x20); enc.encodeInto(s, u); };

function hostile(src) {
  const keep = [];
  return Object.assign(new String("js"), {
    toString() {
      src.buffer.transfer(0);
      Bun.gc(true);
      for (let i = 0; i < 64; i++) {
        const x = new Uint8Array(N);
        fill(x, 'import "recycled-mod"; export const WHICH = "RECYCLED_FOREIGN_HEAP";');
        keep.push(x);
      }
      Bun.gc(true);
      return "js";
    },
  });
}

function mkSrc() {
  const src = new Uint8Array(new ArrayBuffer(N));
  fill(src, 'import "original-mod"; export const WHICH = "ORIGINAL_INPUT";');
  return src;
}

const t = new Bun.Transpiler();

{
  const src = mkSrc();
  const out = t.transformSync(src, hostile(src));
  if (out.includes("recycled-mod") || out.includes("RECYCLED_FOREIGN_HEAP")) {
    throw new Error("transformSync emitted recycled heap: " + JSON.stringify(out.slice(0, 120)));
  }
  if (out.trim() !== "") {
    throw new Error("transformSync: detached buffer should yield empty output, got " + JSON.stringify(out.slice(0, 120)));
  }
}

{
  const src = mkSrc();
  const { imports, exports } = t.scan(src, hostile(src));
  if (imports.some(i => i.path === "recycled-mod")) {
    throw new Error("scan returned recycled heap import: " + JSON.stringify(imports));
  }
  if (imports.length !== 0 || exports.length !== 0) {
    throw new Error("scan: detached buffer should yield no imports/exports, got " + JSON.stringify({ imports, exports }));
  }
}

{
  const src = mkSrc();
  const imports = t.scanImports(src, hostile(src));
  if (imports.some(i => i.path === "recycled-mod")) {
    throw new Error("scanImports returned recycled heap import: " + JSON.stringify(imports));
  }
  if (imports.length !== 0) {
    throw new Error("scanImports: detached buffer should yield no imports, got " + JSON.stringify(imports));
  }
}

console.log("OK");
`;

describe("Bun.Transpiler loader coercion ordering", () => {
  test("transformSync/scan/scanImports read code after loader toString() runs", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: normalizeBunSnapshot(stdout), stderr: normalizeBunSnapshot(stderr), exitCode }).toEqual({
      stdout: "OK",
      stderr: "",
      exitCode: 0,
    });
  });
});
