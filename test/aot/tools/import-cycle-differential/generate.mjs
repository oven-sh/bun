// Usage: bun generate.mjs <out dir> <first seed> <count> [test]
// Writes random programs of ES modules with import cycles. A body can call import() and require() on any module, and can throw.
// main.mjs imports and requires some of them and prints, behind a turn of the event loop, whether each promise is pending, fulfilled or rejected.
// Most modules are named by an import() or a require() here, so most of them store a status. A cycle that nothing names is rare: for that, name fewer modules and write more of them.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [out, firstText, countText, mode] = process.argv.slice(2);
const first = Number(firstText);
const count = Number(countText);

function generator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

rmSync(out, { recursive: true, force: true });
for (let seed = first; seed < first + count; seed++) {
  const random = generator(Math.imul(seed, 2654435761));
  const pick = n => Math.floor(random() * n);
  const chance = p => random() < p;
  const n = 2 + pick(6);
  const dir = join(out, `s${seed}`);
  mkdirSync(dir, { recursive: true });

  const throwers = new Set();
  if (chance(0.5)) throwers.add(pick(n));
  if (chance(0.15)) throwers.add(pick(n));
  const density = 0.15 + random() * 0.35;
  const actionsPerModule = chance(0.3) ? 0 : 3;

  for (let i = 0; i < n; i++) {
    const imports = [];
    for (let j = 0; j < n; j++) if (j !== i && chance(density)) imports.push(j);
    // Imports are evaluated in the order of the text.
    for (let at = imports.length - 1; at > 0; at--) {
      const other = pick(at + 1);
      [imports[at], imports[other]] = [imports[other], imports[at]];
    }
    const lines = imports.map(j => `import "./m${j}.mjs";`);
    lines.push(`log("m${i} runs");`);
    const actions = pick(actionsPerModule + 1);
    for (let action = 0; action < actions; action++) {
      const target = pick(n);
      const kind = pick(3);
      if (kind === 0) lines.push(`keep("m${i} imports m${target}", import("./m${target}.mjs"));`);
      else if (kind === 1 && target !== i)
        lines.push(
          `try { require("./m${target}.mjs"); log("m${i} required m${target}"); } catch (error) { log("m${i}: require of m${target} threw " + error.message); }`,
        );
    }
    if (throwers.has(i)) lines.push(`throw new Error("thrown by m${i}");`);
    lines.push(`log("m${i} ends");`);
    lines.push(`export const name = "m${i}";`);
    writeFileSync(join(dir, `m${i}.mjs`), lines.join("\n") + "\n");
  }

  const main = [
    `const kept = [];`,
    `globalThis.log = text => console.log(text);`,
    `globalThis.keep = (label, promise) => {`,
    `  const entry = { label, state: "pending" };`,
    `  kept.push(entry);`,
    `  promise.then(() => { entry.state = "fulfilled"; }, error => { entry.state = "rejected by " + (error && error.message); });`,
    `};`,
    `const turn = () => new Promise(resolve => setImmediate(resolve));`,
    `const snapshot = async label => { await turn(); log(label + ": " + kept.map(entry => entry.label + " = " + entry.state).join(", ")); };`,
  ];
  const steps = 2 + pick(4);
  for (let step = 0; step < steps; step++) {
    const target = pick(n);
    const kind = pick(4);
    if (kind <= 1) {
      main.push(
        `try { await import("./m${target}.mjs"); log("main: import of m${target} fulfilled"); } catch (error) { log("main: import of m${target} rejected by " + error.message); }`,
      );
    } else if (kind === 2) {
      main.push(`keep("main imports m${target}", import("./m${target}.mjs"));`);
      if (chance(0.5)) continue;
    } else {
      main.push(
        `try { require("./m${target}.mjs"); log("main required m${target}"); } catch (error) { log("main: require of m${target} threw " + error.message); }`,
      );
    }
    main.push(`await snapshot("behind step ${step}");`);
  }
  main.push(`await turn();`, `await snapshot("at the end");`);
  if (mode === "test") {
    // The same steps inside a test of `bun test`, which also prints which of the files require.cache lists.
    const setup = main.slice(0, 9);
    const steps = main.slice(9);
    steps.push(`log("cache: " + Object.keys(require.cache).filter(key => /m\\d\\.mjs$/.test(key)).map(key => key.slice(-6)).sort().join(" "));`);
    writeFileSync(
      join(dir, "main.test.mjs"),
      [`import { test } from "bun:test";`, ...setup, `test("steps", async () => {`, ...steps.map(line => "  " + line), `});`].join("\n") + "\n",
    );
    continue;
  }
  writeFileSync(join(dir, "main.mjs"), main.join("\n") + "\n");
}
