import * as internalForTesting from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const { stringImplHash } = internalForTesting as { stringImplHash?: (s: string) => number };

// JSC's CodeCache keys UnlinkedModuleProgramCodeBlocks on a 24-bit StringImpl
// hash of the source text. Two distinct modules whose *transpiled* source
// happens to hash-collide must NOT share a code block: the second module would
// link bun's JSModuleRecord (which carries the second module's export/local
// names) against the first module's symbol table, producing wrong values or a
// null SymbolTableEntry lookup inside JSModuleNamespaceObject::getOwnPropertySlotCommon.

// Each pair below was mined so the *literal* file bytes collide under WTF's
// StringImpl::hash() (24-bit-masked StringHasher). That only exercises the bug
// while (a) the runtime transpiler emits these sources unchanged and (b) WTF's
// string hash produces the same collision. Both preconditions are asserted so
// the tests fail loudly (rather than go vacuous) when either drifts and the
// pairs need re-mining.
const transpiler = new Bun.Transpiler({ target: "bun" });
function assertCollidingPair(a: string, b: string) {
  for (const src of [a, b]) {
    expect(
      transpiler.transformSync(src, "js"),
      "runtime transpiler no longer emits this fixture byte-for-byte; re-mine the collision pair",
    ).toBe(src);
  }
  expect(a).not.toBe(b);
  if (stringImplHash) {
    expect(
      stringImplHash(a),
      "WTF StringImpl::hash() changed; this pair no longer collides, re-mine the collision pair",
    ).toBe(stringImplHash(b));
  }
}

test.concurrent("modules with hash-colliding source evaluate their own code (const export)", async () => {
  const a = 'export const tag = "T004433";\n';
  const b = 'export const tag = "T004767";\n';
  assertCollidingPair(a, b);

  using dir = tempDir("codecache-collision-const", {
    "a.mjs": a,
    "b.mjs": b,
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

test.concurrent("modules with hash-colliding source do not crash on namespace default access", async () => {
  // The differing function name means the second module's `default` local name
  // is absent from an incorrectly-shared symbol table, which previously hit
  // `ASSERT(iter != symbolTable->end(locker))` in debug and segfaulted in
  // release at SymbolTableEntry::scopeOffset().
  const a = "export default function fn_T000686() {}\n";
  const b = "export default function fn_T004636() {}\n";
  assertCollidingPair(a, b);

  using dir = tempDir("codecache-collision-fn", {
    "a.mjs": a,
    "b.mjs": b,
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
