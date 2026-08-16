import { stringImplHash } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import vm from "node:vm";

// JSC's CodeCache keys every compiled top-level unit (module, program (which is
// also what require() evaluates), eval, `new Function`) on SourceCodeKey, whose
// hash is the 24-bit StringImpl hash of the source text. Two distinct same-length
// sources that collide on it must not share a code block; when they did, the
// second one ran the first one's code, and for ES modules with different
// top-level names it segfaulted.
//
// Each test mines its own colliding pair: sources built from a fixed-width tag,
// so lengths are equal and the first repeated hash is a collision. The 24-bit
// space makes that land after a few thousand candidates. Returns the two tags.
function mineCollidingTags(sourceFor: (tag: string) => string, hashedTextFor = sourceFor): [string, string] {
  const seen = new Map<number, string>();
  for (let i = 0; i < 200_000; i++) {
    const tag = String(i).padStart(6, "0");
    const hash = stringImplHash(hashedTextFor(tag));
    const prev = seen.get(hash);
    if (prev !== undefined) return [prev, tag];
    seen.set(hash, tag);
  }
  throw new Error("no StringImpl::hash() collision in 200k fixed-width candidates");
}

// Files go through the runtime transpiler before JSC hashes them, so a mined
// fixture must come out of it byte-for-byte.
const transpiler = new Bun.Transpiler({ target: "bun" });
function mineCollidingFiles(sourceFor: (tag: string) => string) {
  const tags = mineCollidingTags(sourceFor);
  const sources = tags.map(sourceFor);
  for (const src of sources) expect(transpiler.transformSync(src, "js")).toBe(src);
  return { tags, sources };
}

test("new Function: colliding bodies each run their own code", () => {
  // CreateDynamicFunction compiles (and JSC hashes) the synthesized function
  // source, not the bare body.
  const body = (tag: string) => `return "${tag}"`;
  const tags = mineCollidingTags(body, tag => `function anonymous(\n) {\n${body(tag)}\n}`);
  const [fa, fb] = tags.map(tag => new Function(body(tag)));
  expect(stringImplHash(fa.toString())).toBe(stringImplHash(fb.toString()));
  expect([fa(), fb()]).toEqual(tags);
});

test("indirect eval and vm.Script: colliding sources each run their own code", () => {
  // vm.Script compiles a program the same way require() does for a CommonJS
  // file; it is used here because its source reaches JSC verbatim, whereas the
  // CommonJS function wrapper the runtime prints around a file is not visible
  // to the test, so a colliding pair of files cannot be mined.
  //
  // The source is a template literal rather than a string literal: indirect
  // eval hands JSON-shaped sources to LiteralParser and never compiles (or
  // caches) them, so a plain "..." would pass with or without the fix.
  const source = (tag: string) => "`" + tag + "`";
  const tags = mineCollidingTags(source);
  const sources = tags.map(source);
  expect({
    eval: sources.map(src => (0, eval)(src)),
    script: sources.map(src => new vm.Script(src).runInThisContext()),
  }).toEqual({ eval: tags, script: tags });
});

test("import: colliding ES modules each export their own value", async () => {
  const { tags, sources } = mineCollidingFiles(tag => `export const tag = "${tag}";\n`);
  using dir = tempDir("codecache-collision-esm", { "a.mjs": sources[0], "b.mjs": sources[1] });
  const modules = await Promise.all(["a.mjs", "b.mjs"].map(file => import(join(String(dir), file))));
  expect(modules.map(m => m.tag)).toEqual(tags);
});

test("import: colliding ES modules with different top-level names do not crash", async () => {
  // With different local names the wrongly shared code block's symbol table has
  // no entry for the second module's `default` binding; looking it up tripped
  // an assertion in debug and segfaulted in release, so this case runs in a
  // child process.
  const { tags, sources } = mineCollidingFiles(tag => `export default function fn_${tag}() {}\n`);
  using dir = tempDir("codecache-collision-esm-names", {
    "a.mjs": sources[0],
    "b.mjs": sources[1],
    "run.mjs":
      "const a = await import('./a.mjs');\n" +
      "const b = await import('./b.mjs');\n" +
      "console.log(JSON.stringify([a.default.name, b.default.name]));\n",
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
  expect(JSON.parse(stdout)).toEqual(tags.map(tag => `fn_${tag}`));
  expect(exitCode).toBe(0);
});
