// https://github.com/oven-sh/bun/issues/25569
//
// The ReferenceError for a read or a write in the temporal dead zone names the binding. Bun 1.2.22 did that. From
// Bun 1.2.23 on, JavaScriptCore cut the name out of the source text, at a position it took from a stack walk. A check
// inside a function that a stack trace hides (the function that runs the field initializers of a class, the outer half
// of an async function) got the position of its caller, so the message held '' or unrelated text. With no JavaScript
// caller at all the process crashed. An expression such as `x++` or `x += 1` got the position of an earlier expression.
//
// The check now carries the name.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// A debug build turns on JavaScriptCore's showPrivateScriptsInStackTraces. With it the frames that this file is about are
// not hidden, and the old code found the right position for them. "0" is what a release build runs with.
const options = ["0", "1"] as const;
const envWith = (showPrivateScripts: string) => ({
  ...bunEnv,
  BUN_JSC_showPrivateScriptsInStackTraces: showPrivateScripts,
});

const tdz = (name: string) => `Cannot access '${name}' before initialization.`;

async function run(cwd: string, args: string[], env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Each row is the body of a function: [source, name of the binding]. The fixture gives the source to the engine as
// written, so that the transpiler does not change a row.
const rows: Record<string, [source: string, name: string]> = {
  "field initializer": ["class X { name = foo } new X(); const foo = 1;", "foo"],
  "field initializer, constructor": ["class X { name = foo; constructor() {} } new X(); const foo = 1;", "foo"],
  "field initializer, derived class": ["class B {} class X extends B { name = foo } new X(); const foo = 1;", "foo"],
  "field initializer, derived class with a constructor": [
    "class B {} class X extends B { name = foo; constructor() { super(); } } new X(); const foo = 1;",
    "foo",
  ],
  "field initializer, Reflect.construct": ["class X { name = foo } Reflect.construct(X, []); const foo = 1;", "foo"],
  "private field initializer": ["class X { #p = foo } new X(); const foo = 1;", "foo"],
  "field initializer that writes": ["class X { name = foo++ } new X(); let foo = 1;", "foo"],
  "static field initializer": ["class X { static s = foo } const foo = 1;", "foo"],
  "static field initializer reads a later class": ["class X { static other = new Y() } class Y {}", "Y"],
  "async function": ["async function f(a = b, b) { await null; } return f();", "b"],
  "async arrow function": ["return (async (a = b, b) => { await null; })();", "b"],
  "async method": ["return ({ async m(a = b, b) { await null; } }).m();", "b"],
  "async function through Reflect.apply": [
    "async function f(a = b, b) { await null; } return Reflect.apply(f, undefined, []);",
    "b",
  ],
  "read": ["x; let x;", "x"],
  "call": ["x(); let x;", "x"],
  "assignment": ["x = 1; let x;", "x"],
  "compound assignment": ["x += 1; let x;", "x"],
  "compound assignment behind a call": ["let log = () => {}; log('starting'); retries -= 1; let retries;", "retries"],
  "logical assignment": ["x ||= 1; let x;", "x"],
  "prefix increment": ["++x; let x;", "x"],
  "postfix increment": ["x++; let x;", "x"],
  "postfix increment in parentheses": ["let y = (x)++; let x;", "x"],
  "tagged template": ["x`a`; let x;", "x"],
  "array pattern": ["[x] = [1]; let x;", "x"],
  "object pattern": ["({ x } = {}); let x;", "x"],
  "typeof in parentheses": ["typeof (x); let x;", "x"],
  "captured, prefix increment": ["(() => { ++y; })(); let y;", "y"],
  "captured, compound assignment": ["(() => { y += 1; })(); let y;", "y"],
  "captured, array pattern": ["(() => { [y] = [1]; })(); let y;", "y"],
  "escaped name": ["\\u0078; let x;", "x"],
  "escaped name, write": ["\\u0078++; let x;", "x"],
  "name outside ASCII": ["café += 1; let café;", "café"],
};

const rowsFixture = `
const rows = ${JSON.stringify(Object.fromEntries(Object.entries(rows).map(([label, [source]]) => [label, source])))};
const messages = {};
const pending = [];
for (const [label, source] of Object.entries(rows)) {
  try {
    const result = (0, eval)("(function () {" + source + "\\n})")();
    if (result instanceof Promise)
      pending.push(result.then(() => { messages[label] = "fulfilled"; }, error => { messages[label] = error.message; }));
    else
      messages[label] = "no error";
  } catch (error) {
    messages[label] = error.message;
  }
}
Promise.all(pending).then(() => console.log(JSON.stringify(messages)));
`;

// An async function whose parameter default reads a binding in its dead zone, called with no JavaScript caller.
const noCallerFixture = `
const messages = [];
process.on("unhandledRejection", error => { messages.push(error.message); });
process.on("exit", () => { console.log(JSON.stringify(messages.sort())); });
setTimeout(async (viaTimeout = viaTimeout) => { await null; }, 0);
setImmediate(async (viaImmediate = viaImmediate) => { await null; });
queueMicrotask(async (viaMicrotask = viaMicrotask) => { await null; });
Promise.resolve().then(async (value, viaReaction = viaReaction) => { await null; });
`;

describe.concurrent("a dead zone ReferenceError names the binding", () => {
  test("an uncaught error from a class field initializer", async () => {
    using dir = tempDir("issue-25569-field", {
      "class-first.js": "class X {\n  name = foo\n}\nnew X()\nconst foo = 1\n",
      // The file of the issue. Node names 'X' here: Bun runs a top-level class before the statements above it (#46795),
      // so the first dead zone read is the one of 'foo'.
      "issue.js": "new X()\n\nclass X {\n  name = foo\n  constuctor() {}\n}\n\nconst foo = 1\n",
    });
    for (const file of ["class-first.js", "issue.js"]) {
      const { stdout, stderr, exitCode } = await run(String(dir), [file], envWith("0"));
      expect(stderr).toContain(`ReferenceError: ${tdz("foo")}`);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    }
  });

  test.each(options)("in every kind of frame and expression (showPrivateScriptsInStackTraces=%s)", async option => {
    using dir = tempDir("issue-25569-rows", { "rows.js": rowsFixture });
    const { stdout, stderr, exitCode } = await run(String(dir), ["rows.js"], envWith(option));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(
      Object.fromEntries(Object.entries(rows).map(([label, [, name]]) => [label, tdz(name)])),
    );
    expect(exitCode).toBe(0);
  });

  test.each(options)("with no JavaScript caller (showPrivateScriptsInStackTraces=%s)", async option => {
    using dir = tempDir("issue-25569-no-caller", { "no-caller.js": noCallerFixture });
    const { stdout, stderr, exitCode } = await run(String(dir), ["no-caller.js"], envWith(option));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["viaImmediate", "viaMicrotask", "viaReaction", "viaTimeout"].map(tdz));
    expect(exitCode).toBe(0);
  });

  test.each(["module.mjs", "script.cjs"])("at the top level of %s", async file => {
    const source = `
      class Early { field = count; }
      const messages = [];
      for (const early of [() => { count += 1; }, () => { count++; }, () => new Early()]) {
        try { early(); } catch (error) { messages.push(error.message); }
      }
      let count = messages.length;
      console.log(JSON.stringify(messages));
    `;
    using dir = tempDir("issue-25569-top-level", { [file]: source });
    const { stdout, stderr, exitCode } = await run(String(dir), [file], envWith("0"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([tdz("count"), tdz("count"), tdz("count")]);
    expect(exitCode).toBe(0);
  });

  test("an import in a cycle of two modules is named as the importing module names it", async () => {
    // a.mjs and b.mjs import each other, and b.mjs runs first: the bindings of a.mjs are in their dead zone.
    using dir = tempDir("issue-25569-cycle", {
      "a.mjs": `
        import { messages } from "./b.mjs";
        export let counter = 0;
        export class Api {}
        console.log(JSON.stringify(messages));
      `,
      "b.mjs": `
        import { counter as aliasCounter, Api as HttpApi } from "./a.mjs";
        export const messages = [];
        class Store { api = new HttpApi(); }
        for (const early of [
          () => new Store(),
          () => { class Registry { static shared = new HttpApi(); } },
          () => { ++aliasCounter; },
          () => { aliasCounter += 1; },
          () => HttpApi,
        ]) {
          try { early(); messages.push("no error"); } catch (error) { messages.push(error.message); }
        }
        // A reaction job calls the async function: no JavaScript caller.
        messages.push(
          await Promise.resolve()
            .then(async (first = aliasCounter) => { await null; })
            .then(() => "no error", error => error.message),
        );
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["a.mjs"], envWith("0"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(
      ["HttpApi", "HttpApi", "aliasCounter", "aliasCounter", "HttpApi", "aliasCounter"].map(tdz),
    );
    expect(exitCode).toBe(0);
  });

  test("in code that is loaded from the bytecode cache", async () => {
    // 300 other names stand in front of 'late': the cached instruction that checks it has its wide form.
    const otherNames = Array.from({ length: 300 }, (_, i) => `o.p${i};`).join("");
    using dir = tempDir("issue-25569-bytecode", {
      "app.js": `
        function writes() { try { later += 1; } catch (error) { return error.message; } let later = 0; return later; }
        function constructs() {
          class X { name = foo; }
          try { new X(); } catch (error) { return error.message; }
          const foo = [];
          return foo;
        }
        function wide(o) { ${otherNames} try { late += 1; } catch (error) { return error.message; } let late = 0; return late; }
        console.log(JSON.stringify([writes(), constructs(), wide({})]));
      `,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      outdir: join(String(dir), "out"),
      target: "bun",
      bytecode: true,
    });
    expect(build.success).toBe(true);
    const { stdout, stderr, exitCode } = await run(String(dir), [join("out", "app.js")], {
      ...envWith("0"),
      BUN_JSC_verboseDiskCache: "1",
    });
    expect(stderr).toContain("[Disk Cache] Cache hit");
    expect(JSON.parse(stdout)).toEqual([tdz("later"), tdz("foo"), tdz("late")]);
    expect(exitCode).toBe(0);
  });
});
