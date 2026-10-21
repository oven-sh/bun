// Runs seeded sessions of sloppy script code for repl-transform.test.ts. Each input runs
// as written and as replMode text, both as a script in this global, as `bun repl` runs it.
// Prints the number of sessions and the first sessions that log or leave something else.
// A script cannot delete the `var`s and functions it declares, so this is a process of its own.
// Usage: bun repl-transform-differential-fixture.ts <sessions>, seed in BUN_REPL_FUZZ_SEED.
import vm from "node:vm";

const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });
const seed = Number(process.env.BUN_REPL_FUZZ_SEED ?? 0x7265706c) >>> 0;
const sessions = Number(process.argv[2]);

const different: unknown[] = [];
for (let i = 0; i < sessions; i++) {
  const inputs = generateSession(seed + i);
  const asWritten = runSession(inputs, `_w${i}`, input => input);
  const asRepl = runSession(inputs, `_r${i}`, input => transpiler.transformSync(input));
  if (asWritten !== asRepl) different.push({ seed: seed + i, inputs, asWritten, asRepl });
}
console.log(JSON.stringify({ sessions, different: different.slice(0, 3) }));

// F and G are the names a session declares, LOG is what it records, K is a new number.
// A function in a block is not generated: the visit pass makes it a `let`, which the input
// as written does not have (see "a function in a block" in repl-transform.test.ts).
function generateSession(seed: number): string[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  let k = 0;
  const name = () => pick(["F", "G"]);
  const simple = (): string =>
    pick([
      () => `var ${name()} = ${++k}`,
      () => `var ${name()}`,
      () => `${name()} = ${++k}`,
      () => `LOG.push(typeof ${name()})`,
      () => `LOG.push(typeof globalThis.${name()})`,
      () => `LOG.push(typeof ${name()} === "function" ? ${name()}() : ${++k})`,
      () => `eval("var ${name()} = ${++k}")`,
      () => `eval("function ${name()}() { return ${++k} }")`,
      () => `eval("${name()} = ${++k}")`,
      () => `eval("LOG.push(typeof ${name()})")`,
      () => `(eval)("var ${name()} = ${++k}")`,
      () => `(0, eval)("var ${name()} = ${++k}")`,
      () => `((p = eval("var ${name()} = ${++k}")) => LOG.push(typeof ${name()}))()`,
      () => `(function () { eval("var ${name()} = ${++k}"); LOG.push(typeof ${name()}) })()`,
      () => `{ let B = ${++k}; eval("var ${name()} = B") }`,
    ])();
  const nested = (depth: number): string => {
    const list = () => statements(depth - 1, 2).join("; ");
    return pick([
      () => `{ ${list()} }`,
      () => `if (${pick([0, 1])}) { ${list()} } else { ${list()} }`,
      () => `try { ${list()}; ${pick(["", "throw 1"])} } catch (e) { ${list()} } finally { ${list()} }`,
      () =>
        `switch (${pick([0, 1, 2])}) { case 0: ${list()}; ${pick(["break", ""])}; case 1: ${list()}; default: ${list()} }`,
      () => `L: { ${list()}; ${pick(["break L", ""])}; ${list()} }`,
      () => `for (var I = 0; I < 2; I++) { ${list()} }`,
    ])();
  };
  const statements = (depth: number, max: number): string[] =>
    Array.from({ length: 1 + Math.floor(random() * max) }, () =>
      depth > 0 && random() < 0.3 ? nested(depth) : simple(),
    );
  const topLevel = (): string =>
    random() < 0.3
      ? pick([
          () => `function ${name()}() { return ${++k} }`,
          () => `function ${name()}() { return typeof ${name()} === "function" ? ${++k} : ${++k} }`,
          () => `throw ${++k}`,
        ])()
      : statements(2, 1)[0];
  return Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
    ["void 0", ...Array.from({ length: 1 + Math.floor(random() * 4) }, topLevel)].join("; "),
  );
}

// Runs the inputs in this global under names that no other session uses. Gives the
// errors, the log and the final F and G as one string.
function runSession(inputs: string[], suffix: string, text: (input: string) => string): string {
  const evaluate = (source: string) => vm.runInThisContext(source.replace(/\b(F|G|LOG|I)\b/g, `$1${suffix}`));
  (globalThis as any)[`LOG${suffix}`] = [];
  const errors = inputs.map(input => {
    try {
      evaluate(text(input));
      return "";
    } catch (e) {
      return (e as Error)?.name ?? String(e);
    }
  });
  const final = ["F", "G"].map(name =>
    evaluate(
      `["${name}" in globalThis, typeof ${name} === "function" ? "fn" + ${name}() : typeof ${name} === "undefined" ? "undefined" : String(${name})].join()`,
    ),
  );
  const log = (globalThis as any)[`LOG${suffix}`].join();
  delete (globalThis as any)[`LOG${suffix}`];
  return JSON.stringify({ errors, log, final });
}
