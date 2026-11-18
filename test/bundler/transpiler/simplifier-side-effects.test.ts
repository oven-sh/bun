import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Runtime proof that side effects under `!`/`typeof` are preserved by the
// simplifier. Transpiler-output assertions live in transpiler.test.js.

test("side effects inside ![...] / typeof [...] run at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let n = 0; const fx = () => { n++; return 1 }; ` +
        `const a = ![fx()]; const b = !{ x: fx() }; const c = typeof [fx()]; ` +
        `const d = !(fx(), true); const e = !typeof fx(); ` +
        `console.log(n, a, b, c, d, e);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("5 false false object false false\n");
  expect(exitCode).toBe(0);
});

async function run(source: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim().split("\n"), stderr, exitCode };
}

// The expected lines are what Node.js prints for the same program.
test.concurrent("computed key of an unused object literal is converted as a property key", async () => {
  const { stdout, exitCode } = await run(`
    const sym = Symbol("k");
    const log = [];
    const key = name => ({
      toString() { log.push(name + ".toString"); return name; },
      valueOf() { log.push(name + ".valueOf"); return 1; },
    });
    const hinted = { [Symbol.toPrimitive](hint) { log.push("hint " + hint); return "p"; } };
    const value = name => { log.push("value " + name); return 1; };
    const id = x => x;
    const run = (name, fn) => {
      log.length = 0;
      let result;
      try { result = fn(); } catch (e) { result = e.constructor.name; }
      console.log(name + ": " + [result, ...log].join(", "));
    };
    run("statement", () => { ({ [sym]: 1 }); return "ok"; });
    run("if test", () => { if ({ [sym]: 1 }) return "truthy"; return "falsy"; });
    run("ternary test", () => ({ [sym]: 1 } ? "truthy" : "falsy"));
    run("left of a comma", () => (({ [sym]: 1 }), "ok"));
    run("void", () => { void { [sym]: 1 }; return "ok"; });
    run("in an array", () => { [{ [sym]: 1 }]; return "ok"; });
    run("pure call argument", () => { /* @__PURE__ */ id({ [Symbol.toStringTag]: "Demo" }); return "ok"; });
    run("pure new argument", () => { /* @__PURE__ */ new Object({ [sym]: 1 }); return "ok"; });
    run("getter", () => { ({ get [sym]() { return 1; } }); return "ok"; });
    run("setter", () => { ({ set [sym](v) {} }); return "ok"; });
    run("method", () => { ({ [sym]() {} }); return "ok"; });
    run("async generator", () => { ({ async *[sym]() {} }); return "ok"; });
    run("for init", () => { for (({ [sym]: 1 }); ; ) return "ok"; });
    run("object key", () => { ({ [key("a")]: 1 }); return "ok"; });
    run("Symbol.toPrimitive", () => { ({ [hinted]: 1 }); return "ok"; });
    run("two keys", () => { ({ [key("a")]: value("a"), [key("b")]: value("b") }); return "ok"; });
    run("key without a conversion", () => { ({ [Object.create(null)]: 1 }); return "ok"; });
    run("undeclared key", () => { ({ [notDeclared]: 1 }); return "ok"; });
    run("literal keys", () => {
      ({ ["a"]: value("a"), [1]: value("b"), [null]: 1, [1n]: 1, [true]: 1, [undefined]: 1 });
      return "ok";
    });
    const obj = { fn() { return this === obj ? "obj" : String(this); } };
    run("tag behind a conditional", () => ({ ["a"]: 1 } ? obj.fn : 2)\`x\`);
    run("tag behind a comma", () => (({ ["a"]: 1 }), obj.fn)\`x\`);
    run("name of a function behind a conditional", () => {
      const named = { ["a"]: 1 } ? function () {} : 2;
      return JSON.stringify(named.name);
    });
  `);
  expect(stdout).toEqual([
    "statement: ok",
    "if test: truthy",
    "ternary test: truthy",
    "left of a comma: ok",
    "void: ok",
    "in an array: ok",
    "pure call argument: ok",
    "pure new argument: ok",
    "getter: ok",
    "setter: ok",
    "method: ok",
    "async generator: ok",
    "for init: ok",
    "object key: ok, a.toString",
    "Symbol.toPrimitive: ok, hint string",
    "two keys: ok, a.toString, value a, b.toString, value b",
    "key without a conversion: TypeError",
    "undeclared key: ReferenceError",
    "literal keys: ok, value a, value b",
    "tag behind a conditional: undefined",
    "tag behind a comma: undefined",
    'name of a function behind a conditional: ""',
  ]);
  expect(exitCode).toBe(0);
});

test.concurrent("accessor with a computed key beside a spread in an unused object literal", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const log = [];
    const key = name => ({ toString() { log.push(name); return name; } });
    const rest = { z: 1 };
    ({ get [key("getter")]() { return 1; }, ...rest });
    ({ set [key("setter")](v) {}, ...rest });
    ({ [key("method")]() {}, ...rest });
    ({ async *[key("generator")]() {}, ...rest });
    console.log(log.join(", "));
  `);
  expect({ stdout, stderr }).toEqual({ stdout: ["getter, setter, method, generator"], stderr: "" });
  expect(exitCode).toBe(0);
});
