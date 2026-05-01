import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// GetModuleNamespace over a deep `export * from` chain used to walk the whole
// star graph once per exported name (O(names × edges)). The single-BFS fast
// path resolves every uniquely-bound name in one pass; ambiguity / shadowing /
// indirect exports must still fall back to the spec walk. These cover the
// shapes the fast path has to get right.
test("namespace over export-star chain has every transitive binding", async () => {
  const files: Record<string, string> = { "leaf.mjs": `export const THE_END = true;\n` };
  for (let i = 0; i < 30; i++) {
    const reexports = Array.from({ length: Math.trunc(i * 0.25) }, (_, j) => `export * from "./m${j}.mjs";`).join("\n");
    files[`m${i}.mjs`] =
      `${reexports}\nexport * from "./${i === 29 ? "leaf" : `m${i + 1}`}.mjs";\nexport const v${i} = ${i};\n`;
  }
  files["entry.mjs"] = `
    const ns = await import("./m0.mjs");
    const keys = Object.keys(ns).sort();
    if (keys.length !== 31) throw new Error("expected 31 keys, got " + keys.length);
    if (!ns.THE_END) throw new Error("THE_END missing");
    for (let i = 0; i < 30; i++) if (ns["v" + i] !== i) throw new Error("v" + i + " = " + ns["v" + i]);
    console.log("ok " + keys.length);
  `;
  using dir = tempDir("star-export-chain", files);
  await using proc = Bun.spawn({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toBe("ok 31");
  expect(exitCode).toBe(0);
});

test("star-export ambiguity is excluded from namespace, shadowing wins for named import", async () => {
  using dir = tempDir("star-export-ambig", {
    "a.mjs": `export const dup = "a"; export const onlyA = 1;`,
    "b.mjs": `export const dup = "b"; export const onlyB = 2;`,
    // root: dup is ambiguous (two siblings). onlyA/onlyB unique.
    "root.mjs": `export * from "./a.mjs"; export * from "./b.mjs";`,
    // shadow: local dup shadows the star, so dup is *not* ambiguous here.
    "shadow.mjs": `export * from "./a.mjs"; export * from "./b.mjs"; export const dup = "shadow";`,
    "entry.mjs": `
      const ns = await import("./root.mjs");
      if ("dup" in ns) throw new Error("ambiguous dup leaked into namespace");
      if (ns.onlyA !== 1 || ns.onlyB !== 2) throw new Error("unique bindings missing");
      const sh = await import("./shadow.mjs");
      if (sh.dup !== "shadow") throw new Error("local should shadow star, got " + sh.dup);
      // Named import of an ambiguous binding is a link-time SyntaxError.
      let threw = false;
      try { await import("./named.mjs"); } catch (e) { threw = /ambiguous|multiple/i.test(String(e)); }
      if (!threw) throw new Error("ambiguous named import did not throw");
      console.log("ok");
    `,
    "named.mjs": `import { dup } from "./root.mjs"; export { dup };`,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toBe("ok");
  expect(exitCode).toBe(0);
});

test("indirect re-export through star chain still resolves (slow path)", async () => {
  using dir = tempDir("star-export-indirect", {
    "src.mjs": `export const inner = 42;`,
    "mid.mjs": `export { inner as renamed } from "./src.mjs";`,
    "root.mjs": `export * from "./mid.mjs";`,
    "entry.mjs": `
      const ns = await import("./root.mjs");
      if (ns.renamed !== 42) throw new Error("indirect export lost: " + ns.renamed);
      console.log("ok");
    `,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toBe("ok");
  expect(exitCode).toBe(0);
});
