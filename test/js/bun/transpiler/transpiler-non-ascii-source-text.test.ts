import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// ES2026 §20.2.3.5: Function.prototype.toString must return the source text
// the host has for the function. The runtime transpiler used to rewrite every
// non-ASCII codepoint to an escape sequence, which leaked into toString(),
// RegExp#source, and tagged-template .raw.

const fixture = `
function f() { return "café"; }
class Café { méth(x) { return \`é\${x}é\`; } }
const rx = () => /π+/u.test("ππ");
const tag = (a) => a.raw[0];
const raw = () => tag\`你好𐃘\\\\\`;
const dyn = new Function('return "café";');

console.log(JSON.stringify({
  fn: f.toString(),
  cls: Café.toString(),
  rx: rx.toString(),
  raw: raw(),
  dyn: dyn.toString(),
  emoji: (() => "👍").toString(),
}));
`;

async function run(file: string, cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("runtime transpiler preserves non-ASCII source text", () => {
  for (const ext of ["mjs", "cjs", "ts"] as const) {
    test(`.${ext}`, async () => {
      using dir = tempDir("non-ascii-src", { [`entry.${ext}`]: fixture });
      const { stdout, stderr, exitCode } = await run(`entry.${ext}`, String(dir));
      expect(stderr).toBe("");
      const out = JSON.parse(stdout);

      // Function.prototype.toString — string literal preserved verbatim
      expect(out.fn).toContain('"café"');
      expect(out.fn).not.toContain("\\xE9");
      expect(out.fn).not.toContain("\\u");

      // Class source — identifier, method name, template literal all preserved
      expect(out.cls).toContain("Café");
      expect(out.cls).toContain("méth");
      expect(out.cls).toContain("`é${x}é`");
      expect(out.cls).not.toContain("\\u{e9}");
      expect(out.cls).not.toContain("\\xE9");

      // RegExp literal inside a function body
      expect(out.rx).toContain("/π+/u");
      expect(out.rx).not.toContain("\\u03C0");

      // Tagged template .raw — non-ASCII plus a raw backslash preserved
      expect(out.raw).toBe("你好𐃘\\\\");

      // Astral codepoint in a string literal
      expect(out.emoji).toContain('"👍"');

      // Control: new Function bodies never pass through the file transpiler
      expect(out.dyn).toContain('"café"');

      expect(exitCode).toBe(0);
    });
  }

  test("RegExp.prototype.source", async () => {
    using dir = tempDir("non-ascii-rx", {
      "entry.mjs": `console.log(/π+/u.source);`,
    });
    const { stdout, stderr, exitCode } = await run("entry.mjs", String(dir));
    expect(stderr).toBe("");
    expect(stdout).toBe("π+\n");
    expect(exitCode).toBe(0);
  });

  test("String.raw with non-ASCII", async () => {
    using dir = tempDir("non-ascii-raw", {
      "entry.mjs": `console.log(String.raw\`你好\\n𐃘\`);`,
    });
    const { stdout, stderr, exitCode } = await run("entry.mjs", String(dir));
    expect(stderr).toBe("");
    expect(stdout).toBe("你好\\n𐃘\n");
    expect(exitCode).toBe(0);
  });
});
