import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// JSC's CodeCache keys UnlinkedModuleProgramCodeBlocks on a 24-bit StringImpl
// hash of the source text. Two distinct modules whose *transpiled* source
// happens to hash-collide must NOT share a code block: the second module would
// link bun's JSModuleRecord (which carries the second module's export/local
// names) against the first module's symbol table, producing wrong values or a
// null SymbolTableEntry lookup inside JSModuleNamespaceObject::getOwnPropertySlotCommon.
//
// The strings below are chosen so that bun's runtime transpiler emits them
// byte-for-byte unchanged, i.e. the collision is on the literal source and
// does not depend on transpiler formatting.

test("modules with hash-colliding source evaluate their own code (const export)", async () => {
  using dir = tempDir("codecache-collision-const", {
    // RapidHash("export const tag = \"T004433\";\n") == RapidHash("export const tag = \"T004767\";\n")
    "a.mjs": 'export const tag = "T004433";\n',
    "b.mjs": 'export const tag = "T004767";\n',
    "run.mjs":
      "const a = await import('./a.mjs');\n" +
      "const b = await import('./b.mjs');\n" +
      "console.log(JSON.stringify({ a: a.tag, b: b.tag }));\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ a: "T004433", b: "T004767" });
  expect(exitCode).toBe(0);
});

test("modules with hash-colliding source do not crash on namespace default access", async () => {
  using dir = tempDir("codecache-collision-fn", {
    // RapidHash of these two transpiled sources collides; the differing
    // function name means the second module's `default` local name is absent
    // from the (incorrectly shared) symbol table, which previously segfaulted
    // at SymbolTableEntry::scopeOffset() in release builds.
    "a.mjs": "export default function fn_T000686() {}\n",
    "b.mjs": "export default function fn_T004636() {}\n",
    "run.mjs":
      "const a = await import('./a.mjs');\n" +
      "const b = await import('./b.mjs');\n" +
      "console.log(JSON.stringify({ a: a.default.name, b: b.default.name }));\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ a: "fn_T000686", b: "fn_T004636" });
  expect(exitCode).toBe(0);
});
