/**
 * What module.evaluate() of node:vm does when a module below it failed before
 * its body ran, or has failed when the walk of the dependencies reaches it: it
 * rejects with the error of that module, and it runs nothing that comes after
 * that module.
 *
 * This file uses node:test and node:assert, so Node.js runs the identical
 * file, and the last test starts Node.js on it:
 *
 *   node --experimental-vm-modules vm-module-failed-dependency.test.ts
 *
 * Every expectation outside the "only in Bun" block is what Node.js v26.3.0
 * does. A `notYetInBun` test is one that Bun does not pass yet: Node.js runs
 * it as a test, and Bun lists it as a todo. The tests are not in vm.test.ts
 * because that file uses bun:test, which Node.js cannot run.
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const isBun = typeof process.versions.bun === "string";
// The helpers of Bun's tests. Node.js cannot load them, so this is not a static import.
const harness = isBun ? await import("harness") : undefined;
const notYetInBun = isBun ? test.todo : test;

type Modules = Record<string, vm.SourceTextModule | vm.SyntheticModule>;

// Where the modules of a test live. A context with microtaskMode "afterEvaluate" has its own microtask queue.
const kinds = {
  "the main context": undefined,
  "a context": {},
  "an afterEvaluate context": { microtaskMode: "afterEvaluate" },
} as const;
type Kind = keyof typeof kinds;

// Module code in the main context sees this file's globals. The names of the previous graph go first.
const installed = new Set<string>();
function install(host: Record<string, unknown>) {
  for (const name of installed) delete (globalThis as any)[name];
  installed.clear();
  for (const [name, value] of Object.entries(host)) {
    (globalThis as any)[name] = value;
    installed.add(name);
  }
}

function graph(kind: Kind, sources: Record<string, string>, host: Record<string, unknown> = {}) {
  const log: unknown[] = [];
  host = { log: (entry: unknown) => void log.push(entry), ...host };
  const options = kinds[kind];
  let context: vm.Context | undefined;
  if (options) context = vm.createContext(host, options);
  else install(host);

  const modules: Modules = {};
  const define = (identifier: string, source: string, more: vm.SourceTextModuleOptions = {}) =>
    (modules[identifier] = new vm.SourceTextModule(source, { identifier, context, ...more }));
  for (const [identifier, source] of Object.entries(sources)) define(identifier, source);

  return {
    log,
    context,
    modules,
    define,
    // A vm.SyntheticModule whose evaluateCallback throws `error`.
    failingSynthetic(identifier: string, error: Error) {
      modules[identifier] = new vm.SyntheticModule(
        ["value"],
        () => {
          log.push(`${identifier} callback`);
          throw error;
        },
        { identifier, context },
      );
    },
    link: (root: string) => (modules[root] as vm.SourceTextModule).link(specifier => modules[specifier]),
    statuses: () => Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status])),
  };
}

// The value that `promise` rejects with.
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => assert.fail("the promise fulfilled"),
    (reason: unknown) => reason,
  );

for (const kind of Object.keys(kinds) as Kind[]) {
  describe(`module.evaluate() above a module that failed, in ${kind}`, () => {
    test("a later root does not run the modules that failed in their dependency walk", async () => {
      const g = graph(kind, {
        R: `import "E"; log("R");`,
        E: `import "D"; import "X"; log("E");`,
        D: `import "S"; log("D");`,
        X: `log("X");`,
      });
      const error = new Error("from S");
      g.failingSynthetic("S", error);
      await g.link("R");

      // S fails below D, so the bodies of D and E do not run, and both are errored.
      assert.strictEqual(await rejection(g.modules.E.evaluate()), error);
      assert.deepStrictEqual(g.statuses(), { R: "linked", E: "errored", D: "errored", X: "linked", S: "errored" });

      assert.strictEqual(await rejection(g.modules.R.evaluate()), error);
      assert.deepStrictEqual(g.log, ["S callback"]);
      assert.deepStrictEqual(g.statuses(), { R: "errored", E: "errored", D: "errored", X: "linked", S: "errored" });
      assert.strictEqual(g.modules.R.error, error);
    });

    test("the same, when the modules that failed are an import cycle", async () => {
      const g = graph(kind, {
        R: `import "E"; log("R");`,
        E: `import "D"; import "X"; log("E");`,
        D: `import "E"; import "S"; log("D");`,
        X: `log("X");`,
      });
      const error = new Error("from S");
      g.failingSynthetic("S", error);
      await g.link("R");

      assert.strictEqual(await rejection(g.modules.E.evaluate()), error);
      assert.strictEqual(await rejection(g.modules.R.evaluate()), error);
      assert.deepStrictEqual(g.log, ["S callback"]);
      assert.deepStrictEqual(g.statuses(), { R: "errored", E: "errored", D: "errored", X: "linked", S: "errored" });
    });

    // Bun runs the body of E in the evaluate() of D, before the dependency walk of E comes to S. E is then "errored"
    // with a body that ran, and the later root runs.
    notYetInBun("the same, when the entry of the cycle lists the member of the cycle first", async () => {
      const g = graph(kind, {
        R: `import "E"; log("R");`,
        E: `import "D"; import "S"; log("E");`,
        D: `import "E"; log("D");`,
      });
      const error = new Error("from S");
      g.failingSynthetic("S", error);
      await g.link("R");

      assert.strictEqual(await rejection(g.modules.E.evaluate()), error);
      assert.strictEqual(await rejection(g.modules.R.evaluate()), error);
      assert.deepStrictEqual(g.log, ["D", "S callback"]);
      assert.deepStrictEqual(g.statuses(), { R: "errored", E: "errored", D: "errored", S: "errored" });
    });

    test("a dependency that the importer lists after the failed one does not run", async () => {
      const g = graph(kind, {
        r: `import "e"; import "d"; import "S"; log("r");`,
        e: `log("e"); throw new Error("from e");`,
        d: `log("d");`,
      });
      g.modules.S = new vm.SyntheticModule(["value"], () => void g.log.push("S callback"), {
        identifier: "S",
        context: g.context,
      });
      await g.link("r");

      const error = await rejection(g.modules.e.evaluate());
      assert.strictEqual((error as Error).message, "from e");
      assert.strictEqual(await rejection(g.modules.r.evaluate()), error);
      assert.deepStrictEqual(g.log, ["e"]);
      assert.deepStrictEqual(g.statuses(), { r: "errored", e: "errored", d: "linked", S: "linked" });
      assert.strictEqual(g.modules.r.error, error);
    });

    test("a dependency that failed after a top-level await", async () => {
      const g = graph(kind, {
        r: `import "d"; import "x"; log("r");`,
        d: `log("d 1"); await 0; throw new Error("from d");`,
        x: `log("x");`,
      });
      await g.link("r");

      const error = await rejection(g.modules.d.evaluate());
      assert.strictEqual((error as Error).message, "from d");
      assert.strictEqual(await rejection(g.modules.r.evaluate()), error);
      assert.deepStrictEqual(g.log, ["d 1"]);
      assert.deepStrictEqual(g.statuses(), { r: "errored", d: "errored", x: "linked" });
    });

    test("a dependency that fails in an evaluate() that the body of an earlier dependency starts", async () => {
      const g = graph(
        kind,
        {
          r: `import "a"; import "d"; import "x"; log("r");`,
          a: `log("a"); evaluateD();`,
          d: `log("d"); throw new Error("from d");`,
          x: `log("x");`,
        },
        { evaluateD: () => void g.modules.d.evaluate().catch(() => {}) },
      );
      await g.link("r");

      const error = await rejection(g.modules.r.evaluate());
      assert.strictEqual(error, g.modules.d.error);
      assert.deepStrictEqual(g.log, ["a", "d"]);
      assert.deepStrictEqual(g.statuses(), { r: "errored", a: "evaluated", d: "errored", x: "linked" });
    });

    test("an importer two levels above the failed module, and the module between them", async () => {
      const g = graph(kind, {
        R: `import "M"; import "x"; log("R");`,
        M: `import "e"; import "y"; log("M");`,
        e: `log("e"); throw new Error("from e");`,
        x: `log("x");`,
        y: `log("y");`,
      });
      await g.link("R");

      const error = await rejection(g.modules.e.evaluate());
      assert.strictEqual(await rejection(g.modules.R.evaluate()), error);
      assert.strictEqual(await rejection(g.modules.M.evaluate()), error);
      assert.deepStrictEqual(g.log, ["e"]);
      assert.deepStrictEqual(g.statuses(), { R: "errored", M: "errored", e: "errored", x: "linked", y: "linked" });
      assert.strictEqual(g.modules.M.error, error);
    });

    test("a root above an importer whose own evaluate() stopped at the failed module", async () => {
      const g = graph(kind, {
        R: `import "M"; import "x"; log("R");`,
        M: `import "e"; log("M");`,
        e: `log("e"); throw new Error("from e");`,
        x: `log("x");`,
      });
      await g.link("R");

      const error = await rejection(g.modules.e.evaluate());
      assert.strictEqual(await rejection(g.modules.M.evaluate()), error);
      assert.strictEqual(await rejection(g.modules.R.evaluate()), error);
      assert.deepStrictEqual(g.log, ["e"]);
      assert.deepStrictEqual(g.statuses(), { R: "errored", M: "errored", e: "errored", x: "linked" });
    });

    for (const thrown of ["1", "undefined", "null", "globalThis.thrown = {}"]) {
      test(`the importer rejects with the value that the dependency threw: ${thrown}`, async () => {
        const g = graph(kind, {
          r: `import "e"; import "x"; log("r");`,
          e: `throw ${thrown};`,
          x: `log("x");`,
        });
        await g.link("r");

        const value = await rejection(g.modules.e.evaluate());
        assert.ok(Object.is(await rejection(g.modules.r.evaluate()), value));
        assert.ok(Object.is(g.modules.r.error, value));
        assert.deepStrictEqual(g.log, []);
        assert.deepStrictEqual(g.statuses(), { r: "errored", e: "errored", x: "linked" });
      });
    }

    test("initializeImportMeta of an importer that does not run is not called", async () => {
      const g = graph(kind, { e: `throw new Error("from e");` });
      g.define("r", `import "e"; log(import.meta.url);`, {
        initializeImportMeta: () => void g.log.push("initializeImportMeta"),
      });
      await g.link("r");

      const error = await rejection(g.modules.e.evaluate());
      assert.strictEqual(await rejection(g.modules.r.evaluate()), error);
      assert.deepStrictEqual(g.log, []);
    });

    // Bun calls initializeImportMeta only in evaluate(), before the body. For an importer that does not run, it never does.
    notYetInBun("import.meta of an importer that did not run is made at its first read", async () => {
      const g = graph(kind, { e: `throw new Error("from e");` });
      g.define("r", `import "e"; export function tag() { return import.meta.tag; }`, {
        initializeImportMeta: meta => void ((meta as any).tag = "from initializeImportMeta"),
      });
      await g.link("r");

      await rejection(g.modules.e.evaluate());
      await rejection(g.modules.r.evaluate());
      assert.strictEqual((g.modules.r.namespace as any).tag(), "from initializeImportMeta");
    });

    test("a module whose initializeImportMeta threw does not run for a later root", async () => {
      const g = graph(kind, { R: `import "M"; log("R");` });
      const error = new Error("from initializeImportMeta");
      g.define("M", `log("M " + typeof import.meta.url);`, {
        initializeImportMeta: () => {
          g.log.push("initializeImportMeta");
          throw error;
        },
      });
      await g.link("R");

      assert.strictEqual(await rejection(g.modules.M.evaluate()), error);
      assert.strictEqual(await rejection(g.modules.R.evaluate()), error);
      assert.deepStrictEqual(g.log, ["initializeImportMeta"]);
      assert.deepStrictEqual(g.statuses(), { R: "errored", M: "errored" });
    });

    test("an import cycle whose entry imports a module that failed in its dependency walk", async () => {
      const g = graph(kind, {
        E: `import "D"; import "F"; log("E");`,
        D: `import "E"; log("D");`,
        F: `import "S"; log("F");`,
      });
      const error = new Error("from S");
      g.failingSynthetic("S", error);
      await g.link("E");

      assert.strictEqual(await rejection(g.modules.F.evaluate()), error);
      assert.strictEqual(await rejection(g.modules.E.evaluate()), error);
      // Node.js runs D before it comes to F. Bun enters an import cycle in another order and comes to F first.
      assert.deepStrictEqual(g.log, isBun ? ["S callback"] : ["S callback", "D"]);
      const { D, ...others } = g.statuses();
      assert.deepStrictEqual(others, { E: "errored", F: "errored", S: "errored" });
    });

    test("the namespace of a module that failed before its body ran, and an importer that links it after that", async () => {
      const g = graph(kind, {
        M: `import "S"; export function f() { return g() + 1; } function g() { return 41; } export let later = 1; log("M");`,
      });
      const error = new Error("from S");
      g.failingSynthetic("S", error);
      await g.link("M");
      assert.strictEqual(await rejection(g.modules.M.evaluate()), error);

      // A function declaration has its value since the module linked. Only the body gives `later` a value.
      const namespace = g.modules.M.namespace as { f(): number; later: number };
      assert.strictEqual(namespace.f(), 42);
      assert.throws(() => namespace.later, { name: "ReferenceError" });

      const importer = g.define("U", `import { f } from "M"; log("U " + f());`);
      importer.linkRequests([g.modules.M]);
      importer.instantiate();
      assert.strictEqual(await rejection(importer.evaluate()), error);
      assert.deepStrictEqual(g.log, ["S callback"]);
      assert.deepStrictEqual(g.statuses(), { M: "errored", S: "errored", U: "errored" });
    });

    test("a dependency that still waits at a top-level await does not stop the walk", async () => {
      let open = (): void => assert.fail("d did not run");
      const g = graph(
        kind,
        {
          r: `import "d"; import "a"; import "x"; log("r");`,
          d: `log("d 1"); await new Promise(resolve => waitFor(resolve)); throw new Error("from d");`,
          a: `log("a"); open();`,
          x: `log("x");`,
        },
        { waitFor: (resolve: () => void) => void (open = resolve), open: () => open() },
      );
      await g.link("r");

      g.modules.d.evaluate().catch(() => {});
      const error = await rejection(g.modules.r.evaluate());
      assert.strictEqual((error as Error).message, "from d");
      assert.strictEqual(g.modules.d.error, error);
      assert.deepStrictEqual(g.log, ["d 1", "a", "x"]);
      assert.deepStrictEqual(g.statuses(), { r: "errored", d: "errored", a: "evaluated", x: "evaluated" });
    });

    // A failed instantiate() gives each module that did not link a new module record, and an importer that linked
    // before keeps the old one. I holds the first record of M, and the second one fails.
    test("an importer that holds a replaced module record of the module that failed", async () => {
      const g = graph(kind, {
        I: `import "M"; log("I");`,
        M: `import "S"; log("M");`,
        leaf: `export const x = 1;`,
        bad: `import { nope } from "leaf";`,
        other: `import "bad"; import "M";`,
      });
      const error = new Error("from S");
      g.failingSynthetic("S", error);
      const { I, M, leaf, bad, other } = g.modules as Record<string, vm.SourceTextModule>;
      M.linkRequests([g.modules.S]);
      I.linkRequests([M]);
      bad.linkRequests([leaf]);
      other.linkRequests([bad, M]);
      assert.throws(() => other.instantiate(), { name: "SyntaxError" });
      I.instantiate();
      if (M.status === "unlinked") M.instantiate();

      assert.strictEqual(await rejection(M.evaluate()), error);
      assert.strictEqual(await rejection(I.evaluate()), error);
      assert.deepStrictEqual(g.log, ["S callback"]);
    });

    // The same with two more failed instantiate() calls: J holds the first record of D, and the current record of D
    // fails in the evaluate() of R, which reaches it through the first record of K. D.evaluate() is never called.
    test("an importer of a module whose record failed in the evaluate() of another root", async () => {
      const g = graph(kind, {
        leaf: `export const x = 1;`,
        bad: `import { nope } from "leaf";`,
        D: `log("D"); throw new Error("from D");`,
        J: `import "D"; log("J");`,
        K: `import "D"; log("K");`,
        R: `import "K"; log("R");`,
        a: `import "bad"; import "D";`,
        b: `import "D"; import { nope } from "leaf";`,
        c: `import "bad"; import "K";`,
      });
      const { leaf, bad, D, J, K, R, a, b, c } = g.modules as Record<string, vm.SourceTextModule>;
      J.linkRequests([D]);
      bad.linkRequests([leaf]);
      a.linkRequests([bad, D]);
      assert.throws(() => a.instantiate(), { name: "SyntaxError" });
      J.instantiate();
      b.linkRequests([D, leaf]);
      assert.throws(() => b.instantiate(), { name: "SyntaxError" });
      K.linkRequests([D]);
      R.linkRequests([K]);
      c.linkRequests([bad, K]);
      assert.throws(() => c.instantiate(), { name: "SyntaxError" });
      R.instantiate();

      const error = await rejection(R.evaluate());
      assert.strictEqual((error as Error).message, "from D");
      assert.strictEqual(await rejection(J.evaluate()), error);
      assert.deepStrictEqual(g.log, ["D"]);
      assert.deepStrictEqual([R.status, J.status], ["errored", "errored"]);
    });

    // T throws in the evaluate() of A, which Bun starts for the cycle of R and A. Bun then leaves T "linked" until
    // something evaluates T: the later root stops at R and does not come to T.
    notYetInBun("a module that threw in the walk of an import cycle is errored after a later root", async () => {
      const g = graph(kind, {
        U: `import "R"; import "T"; log("U");`,
        R: `import "A"; import "T"; log("R");`,
        A: `import "R"; export const a = 1;`,
        T: `log("T"); throw new Error("from T");`,
      });
      await g.link("U");

      const error = await rejection(g.modules.R.evaluate());
      assert.strictEqual(await rejection(g.modules.U.evaluate()), error);
      assert.deepStrictEqual(g.log, ["T"]);
      assert.deepStrictEqual(g.statuses(), { U: "errored", R: "errored", A: "errored", T: "errored" });
      assert.strictEqual(g.modules.T.error, error);
    });

    if (kind === "an afterEvaluate context") {
      test("runs the microtask checkpoint of the context before it returns", async () => {
        const g = graph(
          kind,
          {
            a: `import "b"; log("a");`,
            b: `log("b"); throw new Error("from b");`,
          },
          { statusOfImporter: () => g.modules.a.status },
        );
        vm.runInContext(
          `new Promise(resolve => (globalThis.open = resolve)).then(() => log("job: a is " + statusOfImporter()));`,
          g.context!,
        );
        await g.link("a");
        const error = await rejection(g.modules.b.evaluate());

        // The main context resolves the promise: its job waits for the next checkpoint of the context.
        (g.context as any).open();
        assert.deepStrictEqual(g.log, ["b"]);
        const evaluation = g.modules.a.evaluate();
        // The importer has failed when the jobs of that checkpoint run.
        assert.deepStrictEqual(g.log, ["b", "job: a is errored"]);
        assert.strictEqual(await rejection(evaluation), error);
      });

      // Bun runs a microtask checkpoint after each dependency, and Node.js runs one after the whole evaluate(). So in
      // Bun the dependency d fails while the walk goes on, the walk stops at d, and x does not run.
      notYetInBun("a dependency whose top-level await can go on waits for the checkpoint after the walk", async () => {
        let open = (): void => assert.fail("d did not run");
        const g = graph(
          kind,
          {
            r: `import "a"; import "d"; import "x"; log("r");`,
            a: `log("a");`,
            d: `log("d 1"); await new Promise(resolve => waitFor(resolve)); throw new Error("from d");`,
            x: `log("x");`,
          },
          { waitFor: (resolve: () => void) => void (open = resolve) },
        );
        await g.link("r");

        g.modules.d.evaluate().catch(() => {});
        open();
        const evaluation = rejection(g.modules.r.evaluate());
        assert.deepStrictEqual(g.log, ["d 1", "a", "x"]);
        assert.deepStrictEqual(g.statuses(), { r: "errored", a: "evaluated", d: "errored", x: "evaluated" });
        assert.strictEqual(await evaluation, g.modules.d.error);
      });

      notYetInBun("the same in one evaluate() call, when a module of the graph lets the await go on", async () => {
        let open = (): void => assert.fail("d did not run");
        const g = graph(
          kind,
          {
            r: `import "p"; import "a"; import "d"; import "x"; log("r");`,
            p: `import "d"; log("p");`,
            a: `log("a"); open();`,
            d: `log("d 1"); await new Promise(resolve => waitFor(resolve)); throw new Error("from d");`,
            x: `log("x");`,
          },
          { waitFor: (resolve: () => void) => void (open = resolve), open: () => open() },
        );
        await g.link("r");

        const evaluation = rejection(g.modules.r.evaluate());
        assert.deepStrictEqual(g.log, ["d 1", "a", "x"]);
        assert.deepStrictEqual(g.statuses(), {
          r: "errored",
          p: "errored",
          a: "evaluated",
          d: "errored",
          x: "evaluated",
        });
        assert.strictEqual(await evaluation, g.modules.d.error);
      });
    }
  });
}

describe("module.evaluate() above a module that failed, with two modules for one specifier", () => {
  // Bun keeps one module for each specifier of an importer. It finds F for both requests, and stops before G runs.
  notYetInBun("the module of the first request runs before the walk comes to the failed one", async () => {
    const g = graph("the main context", {
      r: `import "dependency"; import "dependency" with { type: "json" }; log("r");`,
      F: `log("F"); throw new Error("from F");`,
      G: `log("G");`,
    });
    const { r, F, G } = g.modules as Record<string, vm.SourceTextModule>;
    F.linkRequests([]);
    F.instantiate();
    const error = await rejection(F.evaluate());
    r.linkRequests([G, F]);
    r.instantiate();

    assert.strictEqual(await rejection(r.evaluate()), error);
    assert.deepStrictEqual(g.log, ["F", "G"]);
    assert.deepStrictEqual(g.statuses(), { r: "errored", F: "errored", G: "evaluated" });
  });
});

type ChildOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | string | null | undefined;
  signal: string | null;
};

// The children of this file start when the file loads, and run beside the tests above them, three at a time. A debug
// build of Bun needs about 400 MB for each.
const waitingChildren: (() => void)[] = [];
let runningChildren = 0;
function startChild(file: string, args: string[], env: NodeJS.Dict<string>) {
  const { promise, resolve } = Promise.withResolvers<ChildOutput>();
  const start = () => {
    runningChildren++;
    execFile(file, args, { encoding: "utf8", env }, (error, stdout, stderr) => {
      runningChildren--;
      waitingChildren.shift()?.();
      resolve({ stdout: stdout.trim(), stderr, exitCode: error ? error.code : 0, signal: error?.signal ?? null });
    });
  };
  if (runningChildren < 3) start();
  else waitingChildren.push(start);
  return promise;
}

// A test of what `script` prints to stdout, in a child of the runtime that runs this file.
function childTest(name: string, script: string, printed: unknown, skip = false) {
  if (skip) return void test.skip(name, () => {});
  const output = startChild(
    harness ? harness.bunExe() : process.execPath,
    [...(harness ? [] : ["--experimental-vm-modules", "--no-warnings"]), "-e", script],
    harness ? harness.bunEnv : { ...process.env, NO_COLOR: "1" },
  );
  test(name, async () => {
    assert.deepStrictEqual(await output, { stdout: JSON.stringify(printed), stderr: "", exitCode: 0, signal: null });
  });
}

// For a child whose case needs the timeout of evaluate() to stop a job of a microtask checkpoint. The timeout is on
// the wall clock, and nothing can make it wait for the job. So the job says when it starts, and when the timeout came
// before that, the child makes the case again with twice the timeout.
const untilTheJobWasStopped = `
  async function untilTheJobWasStopped(attempt) {
    for (let timeout = 50; ; timeout *= 2) {
      const result = await attempt(timeout);
      if (result.jobStarted || timeout >= 1600) return result;
    }
  }
`;

describe("module.evaluate() above a module that failed, in a child process", () => {
  // R must reject and run nothing. Bun 1.4.3 ran E, D and X there, and in this graph those bodies reach a crash of
  // JavaScriptCore: a module with a top-level await ends in a microtask checkpoint that the body of X starts, while
  // that module is on the stack of the walk. A graph with no failed module reaches that crash too, and still does.
  childTest(
    "a later root of an import cycle with a top-level await, when a module of it evaluates other modules",
    `
      const vm = require("node:vm");
      const log = [];
      const modules = {};
      const settle = (name, promise) =>
        promise.then(
          () => log.push(name + " fulfilled"),
          error => log.push(name + " rejected: " + (error.code || error.message)),
        );
      const context = vm.createContext(
        {
          log: entry => void log.push(entry),
          evaluateOther: () => void settle("y", modules.y.evaluate()),
          evaluateNewImporter: () => {
            const fresh = new vm.SourceTextModule('import "D"; log("fresh");', { identifier: "fresh", context });
            try {
              fresh.linkRequests([modules.D]);
              fresh.instantiate();
            } catch (error) {
              log.push("fresh does not link: " + (error.code || error.message));
              return;
            }
            settle("fresh", fresh.evaluate());
          },
        },
        { microtaskMode: "afterEvaluate" },
      );
      const define = (identifier, source) =>
        (modules[identifier] = new vm.SourceTextModule(source, { identifier, context }));
      modules.S = new vm.SyntheticModule(
        ["value"],
        () => {
          log.push("S callback");
          throw new Error("from S");
        },
        { identifier: "S", context },
      );
      define("E", 'import "D"; import "X"; log("E");');
      define("D", 'import "E"; import "S"; log("D 1"); await 0; log("D 2");');
      define("X", 'log("X 1"); evaluateOther(); evaluateNewImporter(); log("X 2");');
      define("R", 'import "E"; log("R");');
      define("y", 'log("y");');
      const linker = specifier => modules[specifier];
      (async () => {
        await modules.R.link(linker);
        await modules.y.link(linker);
        await settle("E", modules.E.evaluate());
        await settle("R", modules.R.evaluate());
        console.log(JSON.stringify(log));
      })();
    `,
    ["S callback", "E rejected: from S", "R rejected: from S"],
  );

  // On Bun 1.4.3 the evaluate() of the new importer ran m4 and m2, and its promise never settled.
  childTest(
    "a new importer of two modules with a top-level await that failed in their dependency walk",
    `
      const vm = require("node:vm");
      const log = [];
      const context = vm.createContext({ log: entry => void log.push(entry) }, { microtaskMode: "afterEvaluate" });
      const modules = {};
      const define = (identifier, source) =>
        (modules[identifier] = new vm.SourceTextModule(source, { identifier, context }));
      modules.m5 = new vm.SyntheticModule(
        ["value"],
        () => {
          log.push("m5 callback");
          throw new Error("from m5");
        },
        { identifier: "m5", context },
      );
      define("m0", 'import "m4"; log("m0");');
      define("m4", 'import "m5"; log("m4 1"); await 0; log("m4 2");');
      define("m2", 'import "m4"; import "m3"; log("m2 1"); await 0; log("m2 2");');
      define("m3", 'log("m3");');
      const settle = promise => promise.then(() => "fulfilled", error => "rejected: " + error.message);
      (async () => {
        for (const root of ["m0", "m2"]) await modules[root].link(specifier => modules[specifier]);
        const results = [await settle(modules.m0.evaluate()), await settle(modules.m4.evaluate())];
        const importer = define("importer", 'import "m2"; import "m4"; log("importer");');
        importer.linkRequests([modules.m2, modules.m4]);
        importer.instantiate();
        results.push(await settle(importer.evaluate()));
        const statuses = Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status]));
        console.log(JSON.stringify({ results, log, statuses }));
      })();
    `,
    {
      results: ["rejected: from m5", "rejected: from m5", "rejected: from m5"],
      log: ["m5 callback"],
      statuses: { m5: "errored", m0: "errored", m4: "errored", m2: "errored", m3: "linked", importer: "errored" },
    },
  );

  // Not the same for a vm.SyntheticModule: its importer runs, with the exports that the callback set before it threw.
  // Node.js then reports a rejected promise of V8 that no program can reach, which node:test counts as a failure of
  // the test that runs. So this one runs in a child process, where a handler takes that report.
  childTest(
    "the importer of a vm.SyntheticModule whose evaluateCallback threw before runs",
    `
      const vm = require("node:vm");
      const entries = [];
      globalThis.log = entry => void entries.push(entry);
      process.on("unhandledRejection", () => {});
      const S = new vm.SyntheticModule(
        ["value"],
        function () {
          this.setExport("value", 7);
          throw new Error("from S");
        },
        { identifier: "S" },
      );
      const modules = {
        S,
        r: new vm.SourceTextModule('import { value } from "S"; import "x"; log("r " + value);', { identifier: "r" }),
        x: new vm.SourceTextModule('log("x");', { identifier: "x" }),
      };
      (async () => {
        await modules.r.link(specifier => modules[specifier]);
        await S.evaluate().catch(error => entries.push("S rejected: " + error.message));
        await modules.r.evaluate();
        await new Promise(resolve => setImmediate(resolve));
        console.log(JSON.stringify({ log: entries, S: S.status, r: modules.r.status, x: modules.x.status }));
      })();
    `,
    {
      log: ["S rejected: from S", "x", "r 7"],
      S: "errored",
      r: "evaluated",
      x: "evaluated",
    },
  );

  // The tests below need the timeout of evaluate() to stop a loop. Such a loop runs in a child: when the timeout does
  // not stop it, the child fails, and this file does not hang. Under node:test Node.js v26.3.0 also stops with a
  // failed assertion of its own (env_->execution_async_id() == 0) when a timeout stops a job of a checkpoint.
  childTest(
    "an importer keeps the error of the module that failed when the timeout stops its checkpoint",
    `
      const vm = require("node:vm");
      ${untilTheJobWasStopped}
      const show = value => (value && value.code) || (value && value.message) || String(value);
      untilTheJobWasStopped(async timeout => {
        let spinning = true;
        let jobStarted = false;
        const context = vm.createContext(
          { started: () => void (jobStarted = true), spinning: () => spinning },
          { microtaskMode: "afterEvaluate" },
        );
        const b = new vm.SourceTextModule('throw new Error("from b");', { identifier: "b", context });
        const a = new vm.SourceTextModule('import "b";', { identifier: "a", context });
        await a.link(() => b);
        await b.evaluate().catch(() => {});
        // A job that waits for the next checkpoint of the context, which is the one of a.evaluate().
        vm.runInContext(
          "new Promise(resolve => (globalThis.open = resolve)).then(() => { started(); while (spinning()); });",
          context,
        );
        context.open();
        const first = await a.evaluate({ timeout }).catch(error => error);
        spinning = false;
        const second = await a.evaluate().catch(error => error);
        return { jobStarted, first: show(first), sameError: a.error === b.error, second: show(second), a: a.status };
      }).then(result => console.log(JSON.stringify(result)));
    `,
    {
      jobStarted: true,
      first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      sameError: true,
      second: "from b",
      a: "errored",
    },
  );

  // Both report the rejected promise of the first evaluate(), which no program can reach. Node.js takes the report
  // back at the second evaluate(), which returns that promise. In Bun the report stays, so a handler takes it.
  // The result does not depend on a read of the status while the call runs.
  const theErrorOfTheBodyStays = {
    jobStarted: true,
    first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
    error: "from m",
    again: true,
    importer: true,
    x: "linked",
  };
  childTest(
    "a module whose body threw keeps that error when the timeout stops its checkpoint",
    `
      const vm = require("node:vm");
      ${untilTheJobWasStopped}
      process.on("unhandledRejection", () => {});
      const show = value => (value && value.code) || (value && value.message) || String(value);
      const bodyThrew = aJobReadsTheStatus =>
        untilTheJobWasStopped(async timeout => {
          let spinning = true;
          let jobStarted = false;
          const modules = {};
          const context = vm.createContext(
            {
              log: () => {},
              started: () => {
                jobStarted = true;
                if (aJobReadsTheStatus) modules.m.status;
              },
              spinning: () => spinning,
            },
            { microtaskMode: "afterEvaluate" },
          );
          const define = (identifier, source) =>
            (modules[identifier] = new vm.SourceTextModule(source, { identifier, context }));
          define("r", 'import "m"; import "x";');
          define("m", 'Promise.resolve().then(() => { started(); while (spinning()); }); throw new Error("from m");');
          define("x", 'log("x");');
          await modules.r.link(specifier => modules[specifier]);
          const first = await modules.m.evaluate({ timeout }).catch(error => error);
          spinning = false;
          const error = modules.m.error;
          const again = await modules.m.evaluate().catch(error => error);
          const importer = await modules.r.evaluate().catch(error => error);
          return {
            jobStarted,
            first: show(first),
            error: show(error),
            again: again === error,
            importer: importer === error,
            x: modules.x.status,
          };
        });
      (async () => {
        console.log(JSON.stringify({ noRead: await bodyThrew(false), aJobReadsTheStatus: await bodyThrew(true) }));
      })();
    `,
    { noRead: theErrorOfTheBodyStays, aJobReadsTheStatus: theErrorOfTheBodyStays },
  );

  // Bun says "errored" for m here, and Node.js says "evaluated". The record of m has no error, so r runs in both.
  childTest(
    "an importer runs when the timeout stopped only the microtask checkpoint of a module whose body had ended",
    `
      const vm = require("node:vm");
      ${untilTheJobWasStopped}
      const show = value => (value && value.code) || (value && value.message) || String(value);
      untilTheJobWasStopped(async timeout => {
        let spinning = true;
        let jobStarted = false;
        const entries = [];
        const context = vm.createContext(
          { log: entry => void entries.push(entry), started: () => void (jobStarted = true), spinning: () => spinning },
          { microtaskMode: "afterEvaluate" },
        );
        const modules = {};
        const define = (identifier, source) =>
          (modules[identifier] = new vm.SourceTextModule(source, { identifier, context }));
        define("r", 'import "m"; import "x"; log("r");');
        define("m", 'log("m"); Promise.resolve().then(() => { started(); while (spinning()); });');
        define("x", 'log("x");');
        await modules.r.link(specifier => modules[specifier]);
        const first = await modules.m.evaluate({ timeout }).catch(error => error);
        spinning = false;
        const importer = await modules.r.evaluate().then(() => "fulfilled", error => "rejected: " + show(error));
        return { jobStarted, first: show(first), importer, log: entries };
      }).then(result => console.log(JSON.stringify(result)));
    `,
    {
      jobStarted: true,
      first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      importer: "fulfilled",
      log: ["m", "x", "r"],
    },
  );

  // m.error is the timeout error in Bun, and the error of the body in Node.js. The importer gets the error of the
  // body in both: that is the error of the module record. Both report the rejected promise of m.evaluate(), which
  // no program can reach after the timeout, so a handler takes it.
  childTest(
    "the importer of a module that threw after the timeout stopped the checkpoint of its evaluate() rejects with what it threw",
    `
      const vm = require("node:vm");
      ${untilTheJobWasStopped}
      process.on("unhandledRejection", () => {});
      const show = value => (value && value.code) || (value && value.message) || String(value);
      untilTheJobWasStopped(async timeout => {
        let spinning = true;
        let jobStarted = false;
        let open;
        const entries = [];
        const context = vm.createContext(
          {
            log: entry => void entries.push(entry),
            started: () => void (jobStarted = true),
            spinning: () => spinning,
            waitFor: resolve => void (open = resolve),
          },
          { microtaskMode: "afterEvaluate" },
        );
        const modules = {};
        const define = (identifier, source) =>
          (modules[identifier] = new vm.SourceTextModule(source, { identifier, context }));
        define("r", 'import "m"; import "x"; log("r");');
        define(
          "m",
          'log("m 1"); Promise.resolve().then(() => { started(); while (spinning()); });' +
            ' await new Promise(resolve => waitFor(resolve)); log("m 2"); throw new Error("from m");',
        );
        define("x", 'log("x");');
        define("empty", "");
        await modules.r.link(specifier => modules[specifier]);
        await modules.empty.link(() => {});
        const first = await modules.m.evaluate({ timeout }).catch(error => error);
        spinning = false;
        if (!jobStarted) return { jobStarted };
        open();
        // The checkpoint of this evaluate() lets m go on, and m throws.
        await modules.empty.evaluate();
        const importer = await modules.r.evaluate().catch(error => error);
        return { jobStarted, first: show(first), importer: show(importer), log: entries, x: modules.x.status };
      }).then(result => console.log(JSON.stringify(result)));
    `,
    {
      jobStarted: true,
      first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      importer: "from m",
      log: ["m 1", "m 2"],
      x: "linked",
    },
  );

  // Node.js gives such a module the error null, and Bun gives it the error of the call. The importer gets the same one.
  childTest(
    "a later root above a module that a timeout stopped rejects with the error of that module, and runs nothing",
    `
      const vm = require("node:vm");
      const entries = [];
      globalThis.log = entry => void entries.push(entry);
      let bodySpins = true;
      globalThis.spinning = () => bodySpins;
      const modules = {};
      const define = (identifier, source) => (modules[identifier] = new vm.SourceTextModule(source, { identifier }));
      define("R", 'import "r"; import "z"; log("R");');
      define("r", 'import "e"; import "x"; log("r");');
      define("e", 'log("e"); while (spinning());');
      define("x", 'log("x");');
      define("z", 'log("z");');
      (async () => {
        await modules.R.link(specifier => modules[specifier]);
        const first = await modules.r.evaluate({ timeout: 50 }).catch(error => error);
        bodySpins = false;
        const second = await modules.R.evaluate().catch(error => error);
        // The timeout is on the wall clock, so on a busy machine it can come before the body of e starts.
        const { e, ...statuses } = Object.fromEntries(
          Object.entries(modules).map(([name, module]) => [name, module.status]),
        );
        console.log(
          JSON.stringify({
            first: first.code,
            second: Object.is(second, modules.r.error),
            error: Object.is(modules.R.error, modules.r.error),
            log: entries.filter(entry => entry !== "e"),
            statuses,
          }),
        );
      })();
    `,
    {
      first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      second: true,
      error: true,
      log: [],
      statuses: { R: "errored", r: "errored", x: "linked", z: "linked" },
    },
  );
});

// Only in Bun, for two reasons. Node.js does not parse `import defer`. And in the other tests Bun differs from Node.js
// on purpose: a module is "errored" in Bun when a timeout or a SIGINT stopped the call before its body ran, and when
// its initializeImportMeta threw before the body. Node.js ran those bodies, says "evaluated", and runs a later root.
if (harness) {
  describe("module.evaluate() above a module that failed, only in Bun", () => {
    // The timeout can be the one of the module's own evaluate(), or of the evaluate() of an importer. The callback of
    // L spins until the timeout stops it, so the case runs in a child.
    childTest(
      "a module that a timeout stopped before its body does not run for a later root",
      `
        const vm = require("node:vm");
        async function stoppedBy(timedCall) {
          const entries = [];
          globalThis.log = entry => void entries.push(entry);
          let spinning = true;
          const modules = {};
          const define = (identifier, source) => (modules[identifier] = new vm.SourceTextModule(source, { identifier }));
          define("R", 'import "r"; log("R");');
          define("r", 'import "L"; import "x"; log("r");');
          define("x", 'log("x");');
          define("later", 'import "r"; import "z"; log("later");');
          define("z", 'log("z");');
          modules.L = new vm.SyntheticModule(
            ["value"],
            () => {
              entries.push("L callback");
              while (spinning);
            },
            { identifier: "L" },
          );
          const linker = specifier => modules[specifier];
          await modules.R.link(linker);
          await modules.later.link(linker);
          const first = await modules[timedCall].evaluate({ timeout: 50 }).catch(error => error);
          spinning = false;
          const second = await modules.later.evaluate().catch(error => error);
          // The timeout is on the wall clock, so on a busy machine it can come before the callback starts.
          const { L, ...statuses } = Object.fromEntries(
            Object.entries(modules).map(([name, module]) => [name, module.status]),
          );
          return {
            first: first.code,
            same: second === modules.r.error,
            log: entries.filter(entry => entry !== "L callback"),
            statuses,
          };
        }
        (async () => {
          console.log(JSON.stringify({ ownEvaluate: await stoppedBy("r"), evaluateOfAnImporter: await stoppedBy("R") }));
        })();
      `,
      {
        ownEvaluate: {
          first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
          same: true,
          log: [],
          statuses: { R: "linked", r: "errored", x: "linked", later: "errored", z: "linked" },
        },
        evaluateOfAnImporter: {
          first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
          same: true,
          log: [],
          statuses: { R: "errored", r: "errored", x: "linked", later: "errored", z: "linked" },
        },
      },
    );

    // POSIX only: the callback sends a real SIGINT to its own process.
    childTest(
      "a module that a SIGINT stopped in the callback of a vm.SyntheticModule does not run for a later root",
      `
        const vm = require("node:vm");
        const entries = [];
        globalThis.log = entry => void entries.push(entry);
        const modules = {};
        const define = (identifier, source) => (modules[identifier] = new vm.SourceTextModule(source, { identifier }));
        define("R", 'import "r"; import "z"; log("R");');
        define("r", 'import "L"; import "x"; log("r");');
        define("x", 'log("x");');
        define("z", 'log("z");');
        modules.L = new vm.SyntheticModule(
          ["value"],
          () => {
            entries.push("L callback");
            process.kill(process.pid, "SIGINT");
            for (;;) {}
          },
          { identifier: "L" },
        );
        (async () => {
          await modules.R.link(specifier => modules[specifier]);
          const first = await modules.r.evaluate({ breakOnSigint: true }).catch(error => error);
          const second = await modules.R.evaluate().catch(error => error);
          const statuses = Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status]));
          console.log(JSON.stringify({ first: first.code, same: second === modules.r.error, log: entries, statuses }));
        })();
      `,
      {
        first: "ERR_SCRIPT_EXECUTION_INTERRUPTED",
        same: true,
        log: ["L callback"],
        statuses: { R: "errored", r: "errored", x: "linked", z: "linked", L: "errored" },
      },
      process.platform === "win32",
    );

    // Node.js calls initializeImportMeta at the first `import.meta` that runs. Here none runs, so in Node.js M and R
    // fulfil. Bun calls it before the body of each module that has an `import.meta`.
    test("a module whose initializeImportMeta threw before a body that reads no import.meta does not run for a later root", async () => {
      const g = graph("the main context", {
        R: `import "M"; import "x"; log("R");`,
        x: `log("x");`,
      });
      const error = new Error("from initializeImportMeta");
      g.define("M", `log("M"); export function url() { return import.meta.url; }`, {
        initializeImportMeta: () => {
          g.log.push("initializeImportMeta");
          throw error;
        },
      });
      await g.link("R");

      assert.strictEqual(await rejection(g.modules.M.evaluate()), error);
      assert.strictEqual(await rejection(g.modules.R.evaluate()), error);
      assert.deepStrictEqual(g.log, ["initializeImportMeta"]);
      assert.deepStrictEqual(g.statuses(), { R: "errored", x: "linked", M: "errored" });
    });

    test("`import defer` of a module that failed does not stop the importer", async () => {
      let readDeferred = (): unknown => assert.fail("r did not run");
      const g = graph(
        "the main context",
        {
          r: `import defer * as e from "e"; import "x"; log("r"); setReader(() => e.value);`,
          e: `log("e"); throw new Error("from e");`,
          x: `log("x");`,
        },
        { setReader: (reader: () => unknown) => void (readDeferred = reader) },
      );
      await g.link("r");

      const error = await rejection(g.modules.e.evaluate());
      await g.modules.r.evaluate();
      assert.deepStrictEqual(g.log, ["e", "x", "r"]);
      // The first read of the namespace evaluates the deferred module, which gives its error.
      assert.throws(readDeferred, thrown => thrown === error);
      assert.deepStrictEqual(g.statuses(), { r: "evaluated", e: "errored", x: "evaluated" });
    });

    test("the first read of a deferred namespace does not run a module that failed in its dependency walk", async () => {
      let readDeferred = (): unknown => assert.fail("r did not run");
      const g = graph(
        "the main context",
        {
          r: `import defer * as e from "e"; log("r"); setReader(() => e.value);`,
          e: `import "S"; log("e"); export const value = 1;`,
        },
        { setReader: (reader: () => unknown) => void (readDeferred = reader) },
      );
      const error = new Error("from S");
      g.failingSynthetic("S", error);
      await g.link("r");

      assert.strictEqual(await rejection(g.modules.e.evaluate()), error);
      await g.modules.r.evaluate();
      assert.throws(readDeferred, thrown => thrown === error);
      assert.deepStrictEqual(g.log, ["S callback", "r"]);
      assert.deepStrictEqual(g.statuses(), { r: "evaluated", e: "errored", S: "errored" });
    });
  });

  // The version whose results this file has.
  const node = harness.nodeExeAtLeast("26.3.0");
  // A direct run, not `node --test`: the runner mode forks a second node process per file. node:test still exits
  // non-zero on any failure.
  const nodeRun =
    node &&
    startChild(node, ["--experimental-vm-modules", "--no-warnings", fileURLToPath(import.meta.url)], process.env);

  describe("Node.js compatibility", () => {
    (nodeRun ? test : test.skip)("all tests pass in Node.js", async () => {
      const { exitCode, stdout, stderr } = await nodeRun!;
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
