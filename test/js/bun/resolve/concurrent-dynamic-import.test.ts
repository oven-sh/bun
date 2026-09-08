import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Two dynamic imports of the same specifier issued before the first async
// transpile/fetch settles must both resolve. Under the new C++ module loader
// each call gets its own embedder fetch promise (the registry entry is created
// only after the first fetch settles), so the loser of that race must still be
// resolved by Bun__onFulfillAsyncModule rather than left pending forever.
test("concurrent dynamic imports of the same module both resolve", async () => {
  using dir = tempDir("concurrent-dyn-import", {
    "shared.ts": `export const heavy = "H";`,
    "modules.ts": `import { heavy } from "./shared";\nexport const lazy = heavy + "-lazy";`,
    "entry.mjs": `
      const first = import("./modules.ts");
      const second = import("./modules.ts");
      const [a, b] = await Promise.all([first, second]);
      if (a.lazy !== "H-lazy" || b.lazy !== "H-lazy") throw new Error("wrong value");
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// Module sources are transpiled on a thread pool. The order in which two
// independent import() graphs finish loading, and therefore the order JSC
// evaluates them in, used to follow whichever pool thread finished first, so
// the same program produced a different evaluation order from run to run.
// Transpile results are now handed back to the loader in request order, which
// makes the evaluation order a function of the graphs alone. For graphs that
// share no modules the shallower graph evaluates first and equal-depth graphs
// evaluate in import() call order, which is also the order node produces.
describe.concurrent("concurrent dynamic imports of disjoint graphs evaluate in a deterministic order", () => {
  const rounds = 5;
  // Padded modules take longer to transpile, so completion order alone would
  // put the padded graph last regardless of its shape.
  const padding = Array.from({ length: 50 }, (_, i) => `export function pad${i}(x) { return x * ${i} + 1; }`).join(
    "\n",
  );

  function chain(files: Record<string, string>, name: string, round: number, depth: number, pad: string) {
    for (let i = 1; i <= depth; i++) {
      const next = i < depth ? `import "./${name}${i + 1}_${round}.mjs";\n` : "";
      files[`${name}${i}_${round}.mjs`] =
        `${next}globalThis.order.push("${name}${i}");\n${pad}\nexport const v = ${i};\n`;
    }
  }

  function entry(first: string, second: string) {
    return `
      const results = [];
      for (let round = 0; round < ${rounds}; round++) {
        globalThis.order = [];
        await Promise.all([import("./${first}_" + round + ".mjs"), import("./${second}_" + round + ".mjs")]);
        results.push(globalThis.order.join(" "));
      }
      console.log(JSON.stringify(results));
    `;
  }

  async function run(files: Record<string, string>) {
    using dir = tempDir("dyn-import-order", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const results: string[] = JSON.parse(stdout.trim());
    expect(exitCode).toBe(0);
    return results;
  }

  test("equal depth: import() call order, even when the first graph is slower to transpile", async () => {
    const files: Record<string, string> = { "entry.mjs": entry("a1", "b1") };
    for (let round = 0; round < rounds; round++) {
      chain(files, "a", round, 4, padding);
      chain(files, "b", round, 4, "");
    }
    const results = await run(files);
    expect(results).toEqual(Array(rounds).fill("a4 a3 a2 a1 b4 b3 b2 b1"));
  });

  test("different depth: the shallower graph first", async () => {
    const files: Record<string, string> = { "entry.mjs": entry("a1", "b1") };
    for (let round = 0; round < rounds; round++) {
      chain(files, "a", round, 5, "");
      chain(files, "b", round, 2, padding);
    }
    const results = await run(files);
    expect(results).toEqual(Array(rounds).fill("b2 b1 a5 a4 a3 a2 a1"));
  });

  test("wide and shallow before narrow and deep", async () => {
    const files: Record<string, string> = { "entry.mjs": entry("w_root", "b1") };
    for (let round = 0; round < rounds; round++) {
      let imports = "";
      for (let i = 1; i <= 5; i++) {
        imports += `import "./w${i}_${round}.mjs";\n`;
        files[`w${i}_${round}.mjs`] = `globalThis.order.push("w${i}");\n${padding}\nexport const v = ${i};\n`;
      }
      files[`w_root_${round}.mjs`] = `${imports}globalThis.order.push("w");\nexport const v = 0;\n`;
      chain(files, "b", round, 3, "");
    }
    const results = await run(files);
    expect(results).toEqual(Array(rounds).fill("w1 w2 w3 w4 w5 w b3 b2 b1"));
  });
});
