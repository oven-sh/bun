import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Assignment to a `const` binding is a runtime TypeError (ECMA-262 PutValue ->
// SetMutableBinding), not an early error. A module whose assignment never runs must load.
async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("issue-45007", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.each([
  ["literal initializer", "const e = 1;"],
  ["non-literal initializer", "const e = Math.random();"],
])("unexecuted assignment to a const loads (%s)", async (_name, decl) => {
  const { stdout, stderr, exitCode } = await run(
    { "index.js": `${decl}\nfunction f() { e = 2 }\nconsole.log("loaded");\n` },
    "index.js",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "loaded\n", stderr: "", exitCode: 0 });
});

test("unexecuted assignment to a const loads from a required CommonJS file", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "chunk.cjs": `const t = 1;\nfunction f() { t = 2 }\nmodule.exports = "chunk";\n`,
      "index.js": `console.log(require("./chunk.cjs"));\n`,
    },
    "index.js",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "chunk\n", stderr: "", exitCode: 0 });
});

test.each([
  ["literal initializer", "const e = 1;"],
  ["non-literal initializer", "const e = Math.random();"],
])("executed assignment to a const throws TypeError at runtime (%s)", async (_name, decl) => {
  const { stdout, stderr, exitCode } = await run(
    {
      "index.js": `${decl}\ntry { e = 2 } catch (err) { console.log(err instanceof TypeError, typeof e) }\n`,
    },
    "index.js",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true number\n", stderr: "", exitCode: 0 });
});

// The exact shape Turbopack (Next.js 16.4, module fragments / tree shaking) emits, minified: every
// export of a module factory gets a live-binding getter and setter, `e.s([name, () => v, e => v = e])`,
// and for a `const` the setter assigns to a constant. It is never called, so the chunk must load.
// Both a literal and an object initializer occur in real chunks (`const t="/middleware"`, `const s={...}`).
const factorySource = `
const factories = [
  e => { const t = "/middleware"; e.s(["a", () => t, e => t = e]) },
  e => { const s = { wait: 1 }; e.s(["a", () => s, e => s = e]) },
  e => { const n = { ...e.x }; const i = (n.c ? n.proxy : n.middleware) || n.default; e.s(["b", () => i, e => i = e, "g", () => n, e => n = e]) },
];
function run() {
  const seen = [];
  for (const f of factories) {
    f({ x: { middleware: "mw" }, s: exports => seen.push(exports.filter(x => typeof x === "string")) });
  }
  return JSON.stringify(seen);
}
`;

test("Turbopack-style CommonJS chunk with unused const setters loads", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "chunk.js": `${factorySource}\nmodule.exports = run;\n`,
      "index.js": `console.log(require("./chunk.js")());\n`,
    },
    "index.js",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: '[["a"],["a"],["b","g"]]\n', stderr: "", exitCode: 0 });
});

test("Turbopack-style ES module chunk with unused const setters loads", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "chunk.mjs": `${factorySource}\nexport { run };\nexport const marker = 1;\n`,
      "index.mjs": `import { run, marker } from "./chunk.mjs";\nconsole.log(run(), marker);\n`,
    },
    "index.mjs",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: '[["a"],["a"],["b","g"]] 1\n', stderr: "", exitCode: 0 });
});

test("calling a Turbopack-style const setter throws TypeError at runtime", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "index.mjs": `let set; const t = "/middleware"; set = e => t = e;
try { set("x") } catch (err) { console.log(err instanceof TypeError, t) }\n`,
    },
    "index.mjs",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true /middleware\n", stderr: "", exitCode: 0 });
});

// Every other form of write target must also stay a runtime error rather than a parse error.
test.each([
  ["compound", "e += 1"],
  ["increment", "e++"],
  ["logical", "e ||= 1"],
  ["array destructuring", "[e] = [1]"],
  ["object destructuring", "({ a: e } = { a: 1 })"],
  ["for-of target", "for (e of [1]) {}"],
  ["for-in target", "for (e in { a: 1 }) {}"],
])("unexecuted %s write to a const loads", async (_name, stmt) => {
  for (const decl of ["const e = 1;", "const e = Math.random();"]) {
    const { stdout, stderr, exitCode } = await run(
      { "index.js": `${decl}\nfunction f() { ${stmt} }\nconsole.log("loaded");\n` },
      "index.js",
    );
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "loaded\n", stderr: "", exitCode: 0 });
  }
});
