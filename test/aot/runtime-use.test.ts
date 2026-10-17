import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    types: [],
  },
});

async function runtimeUse(files: Record<string, string>, command = ["check", "--aot", "--no-pretty"]) {
  using dir = tempDir("aot-runtime-use", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...command, "--aot-explain=runtime-use", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const prefix = "aot: runtime use: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  const whyOpen = lines
    .filter(line => line.startsWith("open "))
    .map(line => line.slice("open ".length).replace(/ in \S+$/, ""));
  return {
    lines,
    facts: new Set(lines),
    world: lines[0] === "closed" ? "closed" : "open",
    whyOpen,
    stdout,
    stderr,
    exitCode,
  };
}

const declared = `declare const HTMLRewriter: any, Bun: any, process: any, console: any, require: any, module: any, Worker: any, addEventListener: any;\n`;
const of = (text: string) => runtimeUse({ "main.ts": declared + text });

describe.concurrent("what a program names of the runtime", () => {
  test("a program that names nothing special has a closed world", async () => {
    const use = await of(`console.log("hello");`);
    expect(use.lines[0]).toBe("closed");
    expect(use.facts.has("global console")).toBe(true);
    expect(use.facts.has("global HTMLRewriter")).toBe(false);
    expect(use.exitCode).toBe(0);
  });

  test.each([
    ["a free identifier", `new HTMLRewriter();`],
    ["typeof", `console.log(typeof HTMLRewriter);`],
    ["a property of globalThis", `new globalThis.HTMLRewriter();`],
    ["a property of globalThis in brackets", `new (globalThis as any)["HTMLRewriter"]();`],
    ["a property of self", `declare const self: any; new self.HTMLRewriter();`],
    ["a property of globalThis.globalThis", `new (globalThis as any).globalThis.HTMLRewriter();`],
    ["a destructured global object", `const { HTMLRewriter: Rewriter } = globalThis as any; new Rewriter();`],
    ["a variable that holds the global object", `const everything: any = globalThis; new everything.HTMLRewriter();`],
    ["the base of a class", `class Mine extends HTMLRewriter {} new Mine();`],
    ["a shorthand property", `console.log({ HTMLRewriter });`],
  ])("a global is named by %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen, named: use.facts.has("global HTMLRewriter") }).toEqual({
      world: "closed",
      whyOpen: [],
      named: true,
    });
  });

  test.each([
    ["a class of the program's own", `export {}; class HTMLRewriter {} new HTMLRewriter();`],
    ["a parameter", `function f(HTMLRewriter: any) { return new HTMLRewriter(); } f(Object);`],
    ["a type", `let rewriter: typeof HTMLRewriter | undefined; console.log(rewriter);`],
    ["a property of another object", `const mine: any = { HTMLRewriter: Object }; new mine.HTMLRewriter();`],
    ["a string", `console.log("HTMLRewriter");`],
  ])("a global is not named by %s", async (_, text) => {
    const use = await runtimeUse({
      "main.ts":
        declared.replace("HTMLRewriter: any, ", "") +
        (text.includes("typeof HTMLRewriter |") ? "declare const HTMLRewriter: any;\n" : "") +
        text,
    });
    expect({ world: use.world, named: use.facts.has("global HTMLRewriter") }).toEqual({
      world: "closed",
      named: false,
    });
  });

  test("properties of Bun and process are listed by name", async () => {
    const use = await runtimeUse({
      "main.ts": `import { file } from "bun";\ndeclare const Bun: any, process: any, console: any;\nconst { write } = Bun;\nconsole.log(Bun.serve, file, write, process.env.HOME, process["argv"]);`,
    });
    expect(use.lines[0]).toBe("closed");
    for (const fact of ["Bun serve", "Bun file", "Bun write", "process env", "process argv"])
      expect(use.lines).toContain(fact);
    expect(use.facts.has("Bun build")).toBe(false);
    expect(use.facts.has("process binding")).toBe(false);
  });

  test("console that escapes leaves the world closed and may be read by any name", async () => {
    const use = await of(`const logger = [console]; logger[0].log(1);`);
    expect(use.lines[0]).toBe("closed");
    expect(use.lines).toContain("console *");
  });

  test("built-in modules, what they require, and the native code they name", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({
      "main.ts": `import { Database } from "bun:sqlite";\ndeclare const console: any;\nconsole.log(Database);`,
    });
    expect(use.lines[0]).toBe("closed");
    expect(use.lines).toContain("module bun:sqlite");
    expect(use.lines).toContain("native JSSQLStatement.cpp:createJSSQLStatementConstructor");
    expect(without.facts.has("module bun:sqlite")).toBe(false);
    expect(without.facts.has("native JSSQLStatement.cpp:createJSSQLStatementConstructor")).toBe(false);
  });

  test("names in a built-in module count only when the module is compiled in", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({
      "main.ts": `import { createServer } from "node:http";\ndeclare const console: any;\nconsole.log(createServer);`,
    });
    expect(use.lines[0]).toBe("closed");
    expect(use.lines).toContain("module node:http");
    expect(use.lines).toContain("Bun serve");
    expect(without.facts.has("Bun serve")).toBe(false);
  });

  test.each([
    ["eval", `eval("1");`, "a call of eval"],
    ["eval that is handed on", `console.log([eval].length);`, "eval"],
    ["the Function constructor", `new Function("return 1")();`, "a call of Function"],
    ["the Function constructor that is handed on", `console.log([Function].length);`, "Function"],
    ["Function('return this')()", `console.log(Function("return this")().Object);`, "a call of Function"],
    [
      "import() of a computed name",
      `const name: string = process.argv[2]; import(name);`,
      "import() of a name that is computed",
    ],
    [
      "import() of a computed path",
      `const name: string = process.argv[2]; import("./" + name);`,
      "import() of a path that is computed",
    ],
    ["require that escapes", `console.log([require].length);`, "require"],
    ["a Worker", `new Worker("./other.ts");`, "Worker"],
    ["Bun.plugin", `Bun.plugin({});`, "Bun.plugin"],
    ["Bun that escapes", `console.log(Object.keys(Bun));`, "Bun"],
    ["process that escapes", `console.log(Object.keys(process));`, "process"],
    ["the global object that escapes", `console.log(Object.keys(globalThis));`, "the global object"],
    [
      "a computed property of the global object",
      `console.log((globalThis as any)[process.argv[2]]);`,
      "the global object",
    ],
    [
      "a computed property of globalThis.self",
      `console.log((globalThis as any).self[process.argv[2]]);`,
      "the global object",
    ],
    ["eval in brackets", `(globalThis as any)["eval"]("1");`, "a call of eval"],
    [
      "a listener on the global object",
      `addEventListener("error", function (this: any) { console.log(this); });`,
      "addEventListener of the global object",
    ],
    [
      "a listener for an event that the program dispatches",
      `declare const dispatchEvent: any; addEventListener("mine", function (this: any) { console.log(this); }); dispatchEvent(new Event("mine"));`,
      "addEventListener and dispatchEvent of the global object",
    ],
    [
      "a listener for a computed event",
      `addEventListener(process.argv[2], function (this: any) { console.log(this); });`,
      "addEventListener of the global object",
    ],
    [
      "a function of its own called on the global object",
      `(globalThis as any).mine = function (this: any) { return this; }; console.log((globalThis as any).mine());`,
      "a function of the program's own that is called on the global object",
    ],
    [
      "an accessor on the global object",
      `Object.defineProperty(globalThis, "mine", { get() { return this; } }); console.log((globalThis as any).mine);`,
      "an accessor on the global object",
    ],
    ["require.cache", `console.log(require.cache);`, "require.main, require.cache or require.extensions"],
    ["node:vm", `import vm from "node:vm"; console.log(vm);`, "a module that loads modules or evaluates text"],
  ])("the world is open with %s", async (_, text, why) => {
    const use = await of(text);
    expect(use.world).toBe("open");
    expect(use.whyOpen).toContain(why);
  });

  test.each([
    ["typeof globalThis.x", `console.log(typeof (globalThis as any).navigator);`],
    ["a default for a missing global", `console.log((globalThis as any).crypto ?? null);`],
    ["a comparison with undefined", `console.log((globalThis as any).navigator !== undefined);`],
    ["in", `console.log("navigator" in globalThis);`],
    ["typeof globalThis", `console.log(typeof globalThis !== "undefined");`],
    ["require.main === module", `console.log(require.main === module);`],
    ["instanceof", `const scope: any = globalThis; console.log(scope instanceof Object);`],
    [
      "a value stored on the global object",
      `(globalThis as any).mine = { count: 1 }; console.log((globalThis as any).mine.count);`,
    ],
    [
      "a value defined on the global object",
      `Object.defineProperty(globalThis, "mine", { value: 1 }); console.log((globalThis as any).mine);`,
    ],
    ["a native function called on the global object", `console.log((globalThis as any).structuredClone(1));`],
    ["a constant name", `const name = "Buffer"; console.log((globalThis as any)[name]);`],
    [
      "process out of the global object",
      `const { process: found } = globalThis as any; console.log(found?.versions?.node);`,
    ],
    ["a type", `let scope: typeof globalThis | undefined; console.log(scope);`],
    ["the descriptor of a property", `console.log(Object.getOwnPropertyDescriptor(globalThis, "navigator"));`],
    [
      "a listener for an event that nothing dispatches",
      `addEventListener("fetch", function (this: any) { console.log(this); });`,
    ],
    [
      "a native function bound to the global object",
      `declare const self: any; console.log(self.removeEventListener.bind(self));`,
    ],
  ])("a feature test leaves the world closed: %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("only what is part of the compiled program counts", () => {
  test("a function that nothing mentions does not open the world", async () => {
    const use = await of(`function never() { return eval("1"); }\nconsole.log(1);`);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test("a function that is mentioned does", async () => {
    const use = await of(`function sometimes() { return eval("1"); }\nconsole.log(sometimes);`);
    expect(use.whyOpen).toContain("a call of eval");
  });
});

describe.concurrent("what a built-in module lets escape", () => {
  test("any property of process may be read once node:cluster is in the program", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({
      "main.ts": `import cluster from "node:cluster";\ndeclare const console: any;\nconsole.log(cluster.isPrimary);`,
    });
    expect(use.lines[0]).toBe("closed");
    expect(use.lines).toContain("process *");
    expect(use.lines.some(line => line.startsWith("escapes process "))).toBe(true);
    expect(without.lines.filter(line => line.endsWith(" *") || line.startsWith("escapes "))).toEqual([]);
  });
});

describe.concurrent("this in a function that is not strict", () => {
  const main = `import lib from "./lib.cjs";\ndeclare const console: any;\nconsole.log(lib);`;
  const why = "this in a function that is not strict";

  test.each([
    ["is returned", `module.exports = function () { return this; };`],
    ["is handed on", `function f(x) { return x; } module.exports = function () { return f.call(this); };`],
    ["is read by a computed name", `module.exports = function (name) { return this[name]; };`],
    [
      "is read by a computed name in an arrow function",
      `module.exports = function (name) { return () => this[name]; };`,
    ],
    [
      "is read by a computed name through a variable",
      `module.exports = function (name) { var self = this; return self[name]; };`,
    ],
  ])("opens the world when it %s", async (_, lib) => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": lib });
    expect(use.world).toBe("open");
    expect(use.whyOpen).toEqual([why]);
  });

  test("names what it reads by literal names", async () => {
    const use = await runtimeUse({
      "main.ts": main,
      "lib.cjs": `module.exports = function () { return new this.HTMLRewriter(); };`,
    });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(use.lines).toContain("global HTMLRewriter");
  });

  test.each([
    ["the file is strict", `"use strict"; module.exports = function () { return this; };`],
    ["the function is strict", `module.exports = function () { "use strict"; return this; };`],
    ["it is a method of a class", `module.exports = class { me() { return this; } };`],
    ["it is at the top of the file", `module.exports = this;`],
  ])("does not open the world when %s", async (_, lib) => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": lib });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test("does not open the world in an ECMAScript module", async () => {
    const use = await runtimeUse({
      "main.ts": `import lib from "./lib.mjs";\ndeclare const console: any;\nconsole.log(lib);`,
      "lib.mjs": `export default function () { return this; }`,
    });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("a call of the Function constructor whose error is caught", () => {
  test.each([
    [
      "new Function in a try block",
      `let allowed = true; try { new Function(""); } catch { allowed = false; } console.log(allowed);`,
    ],
    [
      "Function in a try block",
      `let allowed = true; try { Function(""); } catch { allowed = false; } console.log(allowed);`,
    ],
    [
      "a constant that holds it, in a try block",
      `let allowed = true; try { const F = Function; new F(""); } catch { allowed = false; } console.log(allowed);`,
    ],
    [
      "Function('return this')() in a try block",
      `let found: any; try { found = Function("return this")().Object; } catch {} console.log(found);`,
    ],
  ])("leaves the world closed: %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test.each([
    ["there is no handler", `try { new Function(""); } finally { console.log(1); }`, "a call of Function"],
    ["the call is in the handler", `try { console.log(1); } catch { new Function(""); }`, "a call of Function"],
    [
      "a function lies between",
      `try { const later = () => new Function(""); console.log(later); } catch {}`,
      "a call of Function",
    ],
    [
      "the constant is also stored",
      `let F: any; try { const G = Function; F = G; new G(""); } catch {} console.log(F);`,
      "Function",
    ],
    ["the constructor is handed on", `try { console.log(Function); } catch {}`, "Function"],
  ])("opens the world when %s", async (_, text, why) => {
    const use = await of(text);
    expect(use.world).toBe("open");
    expect(use.whyOpen).toEqual([why]);
  });
});

describe.concurrent("whether anything but the compiled program may run", () => {
  const build = ["build", "--compile", "--aot", "--outfile", "main"];
  const hello = { "main.ts": declared + `console.log("hello");` };
  const aboutTheWorld = (lines: string[]) => lines.filter(line => line.startsWith("world "));

  test("a closed world has no line that says it is open", async () => {
    const use = await runtimeUse(hello);
    expect({ first: use.lines[0], aboutTheWorld: aboutTheWorld(use.lines) }).toEqual({
      first: "closed",
      aboutTheWorld: [],
    });
  });

  test("an open world says so in a line of its own", async () => {
    const use = await of(`eval("1");`);
    expect(use.whyOpen).toContain("a call of eval");
    expect(aboutTheWorld(use.lines)).toEqual(["world open"]);
  });

  test("an executable that holds its modules has a closed world", async () => {
    const use = await runtimeUse(hello, build);
    expect({ first: use.lines[0], aboutTheWorld: aboutTheWorld(use.lines), exitCode: use.exitCode }).toEqual({
      first: "closed",
      aboutTheWorld: [],
      exitCode: 0,
    });
  });

  test("an executable that runs in place has an open world, and names what it named", async () => {
    const use = await runtimeUse(hello, [...build, "--compile-in-place"]);
    expect({ first: use.lines[0], aboutTheWorld: aboutTheWorld(use.lines), exitCode: use.exitCode }).toEqual({
      first: "open it runs in place",
      aboutTheWorld: ["world open"],
      exitCode: 0,
    });
    expect(use.lines).toContain("global console");
  });
});
