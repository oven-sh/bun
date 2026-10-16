// Run with a shape name: builds that shape of template literal `+` fold,
// transpiles it once with target "bun" (syntax minification on), checks the
// folded output, and prints how much memory the transform took.
const rss = () =>
  (process.platform === "darwin" ? Bun.unsafe.memoryFootprint?.() : undefined) ?? process.memoryUsage.rss();
const rep = (s: string, n: number) => Buffer.alloc(s.length * n, s).toString();
const chain = (term: string, n: number) => Array(n).fill(term).join(" + ");
const nest = (first: string, levels: number, wrap: (inner: string) => string) => {
  let s = first;
  for (let i = 1; i < levels; i++) s = wrap(s);
  return s;
};
const letRun = (n: number, first: string, step: (prev: string) => string) => {
  let s = "function f(x) {\n  let t0 = " + first + ";\n";
  for (let i = 1; i < n; i++) s += "  let t" + i + " = " + step("t" + (i - 1)) + ";\n";
  return s + "  return t" + (n - 1) + ";\n}\ncapture(f);";
};
const inFunction = (body: string) => "function f(x) {\n  return " + body + ";\n}\ncapture(f);\n";

// One substitution per term, for the flat shapes.
const t = "a${x}b";
const T = "`" + t + "`";
// Sixteen substitutions per term, so that a nested shape needs few levels.
const w = rep("a${x}", 16) + "b";
const W = "`" + w + "`";
// `!x` is a boolean, so the fold may move a later operand in front of it.
const u = "a${!x}b";
const U = "`" + u + "`";

// Each shape: [source, expected output]. All of them took about 135 MB before
// the parts of a template could grow in place.
export const shapes: Record<string, () => [string, string]> = {
  "left chain": () => ["capture(" + chain(T, 2048) + ");", "capture(`" + rep(t, 2048) + "`);\n"],
  "chain after a non-constant operand": () => [
    "capture(w + " + chain(T, 2048) + ");",
    "capture(w + `" + rep(t, 2048) + "`);\n",
  ],
  "strings between the templates": () => [
    "capture(" + chain(T + " + 'k'", 2048) + ");",
    "capture(`" + rep(t + "k", 2048) + "`);\n",
  ],
  "chains inside substitutions": () => [
    "capture(" + chain("`o${" + T + " + " + T + "}c`", 2048) + ");",
    "capture(`" + rep("o${`" + t + t + "`}c", 2048) + "`);\n",
  ],
  "string + (accumulator + template)": () => [
    "capture(" + nest(W, 512, s => "'s' + (" + s + " + " + W + ")") + ");",
    "capture(`" + rep("s", 511) + rep(w, 512) + "`);\n",
  ],
  "right-nested chain": () => [
    "capture(" + nest(W, 512, s => W + " + (" + s + ")") + ");",
    "capture(`" + rep(w, 512) + "`);\n",
  ],
  "accumulator between two templates": () => [
    "capture(" + nest(W, 256, s => W + " + (" + s + ") + " + W) + ");",
    "capture(`" + rep(w, 511) + "`);\n",
  ],
  "right-nested chain, then a left chain": () => [
    "capture((" + nest(W, 256, s => W + " + (" + s + ")") + ") + " + chain(W, 256) + ");",
    "capture(`" + rep(w, 512) + "`);\n",
  ],
  "single-use let run": () => [letRun(1448, T, prev => prev + " + " + T), inFunction("`" + rep(t, 1448) + "`")],
  "single-use let run, accumulator on the right": () => [
    letRun(1448, U, prev => U + " + " + prev),
    inFunction("`" + rep(u, 1448) + "`"),
  ],
  // No `+` at all: each substituted `let` visits the same 1448-part template again.
  "template visited again for each let": () => [
    letRun(1448, "`" + rep(t, 1448) + "`", prev => "!" + prev),
    inFunction("!`" + rep(t, 1448) + "`"),
  ],
};

if (import.meta.main) {
  const name = process.argv[2];
  const [source, expected] = shapes[name]();
  const before = rss();
  const out = new Bun.Transpiler({ target: "bun" }).transformSync(source);
  const after = rss();
  if (out !== expected) {
    let i = 0;
    while (i < out.length && out[i] === expected[i]) i++;
    throw new Error(
      `wrong output for "${name}" at ${i} of ${expected.length}: ` +
        JSON.stringify(out.slice(Math.max(0, i - 20), i + 40)) +
        " != " +
        JSON.stringify(expected.slice(Math.max(0, i - 20), i + 40)),
    );
  }
  console.log(JSON.stringify({ delta_mb: (after - before) / 1024 / 1024 }));
}
