import { describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import { itBundled } from "./expectBundled";
import { checkGraph } from "./tla-fuzz/check";

// The design: src/bundler/linker_context/top-level-await.md
//
// Each program prints what it prints unbundled (under Node; `bun run` evaluates an imported CommonJS module earlier).
//
// `order` bundles a program twice: as it is, where the linker does the walk of InnerModuleEvaluation (`__tlaNode`),
// and behind an `import()`, where every module is a wrapper and the walk happens at run time (`__tlaModule`).
function order(name: string, files: Record<string, string>, stdout: string, behindImportCall = true) {
  itBundled("tla/" + name, {
    files,
    format: "esm",
    target: "bun",
    run: { stdout },
  });
  if (behindImportCall) {
    itBundled("tla/" + name + "BehindImportCall", {
      files: { "/outer.js": `await import("./entry.js"); console.log("imported");`, ...files },
      format: "esm",
      target: "bun",
      run: { stdout: stdout + "\nimported" },
    });
  }
}

// The bundle is imported by a file that is not part of it.
function imported(name: string, files: Record<string, string>, runner: string, stdout: string) {
  itBundled("tla/" + name, {
    files,
    format: "esm",
    target: "bun",
    runtimeFiles: { "/runner.js": runner },
    run: { file: "/runner.js", stdout },
  });
}
const settle = `
  import("./out.js")
    .then(() => console.log("fulfilled"), e => console.log("rejected:", e.message))
    .then(() => globalThis.afterSettled?.());
`;

describe.concurrent("bundler", () => {
  // A module that is suspended at an await does not hold back its siblings.
  order(
    "SyncSiblingRunsWhileAwaiting",
    {
      "/entry.js": `
        import "./a.js";
        import "./b.js";
        import "./c.js";
        console.log("entry");
      `,
      "/a.js": `
        console.log("a1");
        await 0;
        console.log("a2");
      `,
      "/b.js": `console.log("b");`,
      "/c.js": `
        console.log("c1");
        await 0;
        console.log("c2");
      `,
    },
    "a1\nb\nc1\na2\nc2\nentry",
  );

  // Printing the modules one after the other makes this program wait forever.
  order(
    "LaterSiblingSettlesTheAwait",
    {
      "/entry.js": `
        import "./waiter.js";
        import "./signal.js";
        console.log("entry");
      `,
      "/waiter.js": `
        console.log("waiting");
        await new Promise(resolve => (globalThis.go = resolve));
        console.log("resumed");
      `,
      "/signal.js": `
        console.log("signal");
        globalThis.go();
      `,
    },
    "waiting\nsignal\nresumed\nentry",
  );

  // c settles before b. When b settles x1, y1, x2 and y2 are all ready, and they run in the order of the walk.
  order(
    "ReadyImportersRunInImportOrder",
    {
      "/entry.js": `
        import "./y2.js";
        console.log("entry");
      `,
      "/y2.js": `
        import "./y1.js";
        import "./x2.js";
        console.log("y2");
      `,
      "/y1.js": `
        import "./x1.js";
        import "./c.js";
        console.log("y1");
      `,
      "/x1.js": `
        import "./b.js";
        console.log("x1");
      `,
      "/x2.js": `
        import "./b.js";
        console.log("x2");
      `,
      "/b.js": `
        console.log("b1");
        for (let i = 0; i < 5; i++) await 0;
        console.log("b2");
      `,
      "/c.js": `
        console.log("c1");
        await 0;
        console.log("c2");
      `,
    },
    "b1\nc1\nc2\nb2\nx1\ny1\nx2\ny2\nentry",
  );

  // No promise job runs between the importers that one settled module makes ready, and one runs before them.
  order(
    "ImportersRunInOneJob",
    {
      "/entry.js": `
        import "./p.js";
        import "./q.js";
        console.log("entry");
      `,
      "/p.js": `
        import "./t.js";
        console.log("p");
        Promise.resolve().then(() => console.log("job of p"));
      `,
      "/q.js": `
        import "./t.js";
        console.log("q");
        Promise.resolve().then(() => console.log("job of q"));
      `,
      "/t.js": `
        await 0;
        console.log("t");
        Promise.resolve().then(() => console.log("job of t"));
      `,
    },
    "t\njob of t\np\nq\nentry\njob of p\njob of q",
  );

  // x imports c2, which has run, but c1 is the [[CycleRoot]] and still waits for slow.
  order(
    "ImporterOfCycleMemberWaitsForTheCycle",
    {
      "/entry.js": `
        import "./c1.js";
        import "./x.js";
        console.log("entry");
      `,
      "/c1.js": `
        import "./c2.js";
        import "./slow.js";
        console.log("c1");
      `,
      "/c2.js": `
        import "./c1.js";
        console.log("c2");
      `,
      "/x.js": `
        import "./c2.js";
        console.log("x");
      `,
      "/slow.js": `
        console.log("slow 1");
        await 0;
        console.log("slow 2");
      `,
    },
    "c2\nslow 1\nslow 2\nc1\nx\nentry",
  );

  // s reaches a top-level await only through modules that the walk is still in, so it runs during the walk, and t2
  // starts without waiting for t1.
  order(
    "CycleMemberDoesNotWaitForAModuleThatIsBeingEntered",
    {
      "/entry.js": `
        import "./a.js";
        console.log("entry");
      `,
      "/a.js": `
        import "./t1.js";
        import "./t2.js";
        console.log("a");
      `,
      "/t1.js": `
        import "./s.js";
        console.log("t1 start");
        for (let i = 0; i < 4; i++) await 0;
        console.log("t1 end");
      `,
      "/s.js": `
        import "./t1.js";
        import "./a.js";
        console.log("s");
      `,
      "/t2.js": `
        import "./s.js";
        console.log("t2 start");
        await 0;
        console.log("t2 end");
      `,
    },
    "s\nt1 start\nt2 start\nt2 end\nt1 end\na\nentry",
  );

  // [[HasTLA]] is about the syntax: p runs in a promise job even though t never suspends.
  order(
    "AwaitThatIsNotReachedStillMakesTheModuleAsync",
    {
      "/entry.js": `
        import "./p.js";
        import "./b.js";
        console.log("entry");
      `,
      "/p.js": `
        import "./t.js";
        console.log("p");
      `,
      "/t.js": `
        console.log("t");
        if (globalThis.never) await 0;
      `,
      "/b.js": `
        console.log("b");
        Promise.resolve().then(() => console.log("job of b"));
      `,
    },
    "t\nb\np\nentry\njob of b",
  );

  // AsyncModuleExecutionFulfilled goes on with the modules that do not import the one that threw.
  imported(
    "IndependentImporterRunsAfterASiblingThrows",
    {
      "/entry.js": `
        import "./bad.js";
        import "./good.js";
        console.log("entry");
      `,
      "/bad.js": `
        import "./t.js";
        console.log("bad");
        throw new Error("from bad");
      `,
      "/good.js": `
        import "./t.js";
        console.log("good");
      `,
      "/t.js": `
        await 0;
        console.log("t");
      `,
    },
    settle,
    "t\nbad\ngood\nrejected: from bad",
  );

  // The walk stops at bad. t has started and p is parked on it, so both still run.
  imported(
    "ThrowDuringTheWalkLeavesStartedModulesRunning",
    {
      "/entry.js": `
        import "./p.js";
        import "./bad.js";
        import "./never.js";
        console.log("entry");
      `,
      "/p.js": `
        import "./t.js";
        console.log("p");
      `,
      "/t.js": `
        console.log("t1");
        await new Promise(resolve => (globalThis.afterSettled = resolve));
        console.log("t2");
      `,
      "/bad.js": `
        console.log("bad");
        throw new Error("from bad");
      `,
      "/never.js": `console.log("never");`,
    },
    settle,
    "t1\nbad\nrejected: from bad\nt2\np",
  );

  // The entry point rejects as soon as t does, while u is still running.
  imported(
    "RejectionReachesEveryImporter",
    {
      "/entry.js": `
        import "./p.js";
        import "./u.js";
        console.log("entry");
      `,
      "/p.js": `
        import "./t.js";
        console.log("p");
      `,
      "/t.js": `
        console.log("t1");
        await 0;
        throw new Error("from t");
      `,
      "/u.js": `
        console.log("u1");
        await new Promise(resolve => (globalThis.afterSettled = resolve));
        console.log("u2");
      `,
    },
    settle,
    "t1\nu1\nrejected: from t\nu2",
  );

  // import() never evaluates anything before it returns.
  order(
    "ImportCallStartsAfterTheCallersCode",
    {
      "/entry.js": `
        console.log("before");
        const promise = import("./lazy.js");
        console.log("after");
        console.log((await promise).value);
      `,
      "/lazy.js": `
        import "./a.js";
        import "./b.js";
        import "./c.js";
        export const value = "lazy";
        console.log("lazy");
      `,
      "/a.js": `
        console.log("a1");
        await 0;
        console.log("a2");
      `,
      "/b.js": `console.log("b");`,
      "/c.js": `
        console.log("c1");
        await 0;
        console.log("c2");
      `,
    },
    "before\nafter\na1\nb\nc1\na2\nc2\nlazy\nlazy",
  );

  order(
    "ImportCallOfAModuleThatIsRunningWaitsForIt",
    {
      "/entry.js": `
        import "./slow.js";
        import "./asks.js";
        console.log("entry");
      `,
      "/slow.js": `
        export let state = "started";
        console.log("slow 1");
        for (let i = 0; i < 20; i++) await 0;
        state = "done";
        console.log("slow 2");
      `,
      "/asks.js": `
        import("./slow.js").then(ns => console.log("asks got", ns.state));
        console.log("asks");
      `,
    },
    "slow 1\nasks\nslow 2\nentry\nasks got done",
  );

  order(
    "ImportCallRejectsWithTheSameErrorEveryTime",
    {
      "/entry.js": `
        const errors = [];
        for (let i = 0; i < 2; i++) await import("./top.js").catch(e => errors.push(e));
        console.log(errors.length, errors[0] === errors[1], errors[0].message);
      `,
      "/top.js": `
        import "./t.js";
        console.log("top");
      `,
      "/t.js": `
        console.log("t");
        await 0;
        throw new Error("from t");
      `,
    },
    "t\n2 true from t",
  );

  // t has settled when the second import() runs, so user and after run in one go, like modules that reach no await.
  order(
    "ImporterOfASettledModuleRunsInsideTheWalk",
    {
      "/entry.js": `
        await import("./t.js");
        await import("./top.js");
        console.log("entry");
      `,
      "/top.js": `
        import "./user.js";
        import "./after.js";
        console.log("top");
      `,
      "/user.js": `
        import { t } from "./t.js";
        console.log("user", t);
        Promise.resolve().then(() => console.log("job of user"));
      `,
      "/after.js": `console.log("after");`,
      "/t.js": `
        export const t = await "T";
        console.log("t");
      `,
    },
    "t\nuser T\nafter\ntop\njob of user\nentry",
  );

  // Node never settles this one. Bun's module loader does not let what an import() loads wait for the module that
  // the import() is written in.
  order(
    "ImportCallTargetImportsTheCallerBack",
    {
      "/entry.js": `
        export const value = "V";
        const { helper } = await import("./b.js");
        console.log(helper);
      `,
      "/b.js": `
        import { value } from "./entry.js";
        export const helper = value + "!";
      `,
    },
    "V!",
    false,
  );

  // What an import statement does (here: run a CommonJS module) happens during the walk, also when the importer's
  // own code has to wait.
  order(
    "CommonJSImportsKeepTheirPlace",
    {
      "/entry.js": `
        import c1 from "./cjs1.cjs";
        import { t } from "./tla.js";
        import c2 from "./cjs2.cjs";
        import { mid, Mid, midFn } from "./mid.js";
        import * as ns from "./star.js";
        console.log("entry", c1.name, t, c2.name, mid, new Mid().x, midFn(), Object.keys(ns).join());
      `,
      "/cjs1.cjs": `
        console.log("cjs1");
        module.exports = { name: "c1" };
      `,
      "/cjs2.cjs": `
        console.log("cjs2");
        module.exports = { name: "c2" };
      `,
      "/cjs3.cjs": `
        console.log("cjs3");
        exports.three = 3;
      `,
      "/tla.js": `
        console.log("tla 1");
        export const t = await Promise.resolve("T");
        console.log("tla 2");
      `,
      "/mid.js": `
        import { three } from "./cjs3.cjs";
        import { t } from "./tla.js";
        import { plain } from "./plain.js";
        export const mid = "mid(" + t + three + plain + ")";
        export class Mid { x = mid.length }
        export function midFn() { return "fn" + t }
        console.log("mid");
      `,
      "/plain.js": `
        console.log("plain");
        export const plain = "p";
      `,
      "/star.js": `
        export * from "./tla.js";
        export * from "./plain.js";
        console.log("star");
      `,
    },
    "cjs1\ntla 1\ncjs2\ncjs3\nplain\ntla 2\nmid\nstar\nentry c1 T c2 mid(T3p) 8 fnT plain,t",
  );

  imported(
    "EntryPointExports",
    {
      "/entry.js": `
        import { t } from "./t.js";
        export { t };
        export const fromEntry = "e" + t;
        export default class Entry {}
        export function fn() { return fromEntry }
      `,
      "/t.js": `export const t = await "T";`,
    },
    `const ns = await import("./out.js"); console.log(Object.keys(ns).join(), ns.t, ns.fromEntry, ns.default.name, ns.fn());`,
    "default,fn,fromEntry,t T eT Entry eT",
  );

  const diamond = {
    "/entry.js": `
      import { left } from "./left.js";
      import { plain } from "./plain.js";
      import { right } from "./right.js";
      console.log("entry", left, plain, right);
    `,
    "/left.js": `
      import { t } from "./t.js";
      export const left = "left-" + t;
      console.log(left);
    `,
    "/right.js": `
      import { t } from "./t.js";
      import { u } from "./u.js";
      export const right = "right-" + t + u;
      console.log(right);
    `,
    "/plain.js": `
      export const plain = "plain";
      console.log(plain);
    `,
    "/t.js": `
      console.log("t1");
      export const t = await "T";
      console.log("t2");
    `,
    "/u.js": `
      console.log("u1");
      export const u = await "U";
      console.log("u2");
    `,
  };
  const diamondStdout = "t1\nplain\nu1\nt2\nu2\nleft-T\nright-TU\nentry left-T plain right-TU";

  itBundled("tla/ModulesThatReachNoAwaitStayUnwrapped", {
    files: diamond,
    format: "esm",
    target: "bun",
    run: { stdout: diamondStdout },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out.slice(out.indexOf("// t.js"))).toMatchInlineSnapshot(`
        "// t.js
        var t;
        var init_t = __tlaNode(async () => {
          console.log("t1");
          t = await "T";
          console.log("t2");
          __tlaDone(init_t);
        }, 1, []);

        // left.js
        var left;
        var init_left = __tlaNode(() => {
          left = "left-" + t;
          console.log(left);
        }, 0, [init_t]);

        // plain.js
        var plain = "plain";
        console.log(plain);

        // u.js
        var u;
        var init_u = __tlaNode(async () => {
          console.log("u1");
          u = await "U";
          console.log("u2");
          __tlaDone(init_u);
        }, 1, []);

        // right.js
        var right;
        var init_right = __tlaNode(() => {
          right = "right-" + t + u;
          console.log(right);
        }, 0, [init_t, init_u]);

        // entry.js
        await __tlaMain([init_left, init_right]);
        __tlaResume();
        console.log("entry", left, plain, right);
        "
      `);
      // The walk at run time is only for what import() reaches.
      expect(out).not.toContain("__tlaModule");
      expect(out).not.toContain("__esm");
    },
  });

  // Nobody can tell when a module runs that only declares things. It gets no wrapper, and its importers wait for what
  // it would have waited for.
  itBundled("tla/ModuleThatEvaluatesNothingIsNotWrapped", {
    files: {
      "/entry.js": `
        import { find, Repo, limit } from "./barrel.js";
        import "./log.js";
        console.log("entry", find(), new Repo().all(), limit);
      `,
      "/barrel.js": `
        export * from "./api.js";
        export { limit } from "./limit.js";
      `,
      "/api.js": `
        import { db } from "./db.js";
        export function find() { return db.name; }
        export class Repo { all() { return [db.name]; } }
        export const count = () => db.size;
      `,
      "/limit.js": `
        import { db } from "./db.js";
        export const limit = db.size * 2;
        console.log("limit");
      `,
      "/db.js": `
        console.log("connecting");
        export const db = await { name: "db", size: 2 };
        console.log("connected");
      `,
      "/log.js": `console.log("log");`,
    },
    format: "esm",
    target: "bun",
    run: { stdout: 'connecting\nlog\nconnected\nlimit\nentry db [ "db" ] 4' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out.slice(out.indexOf("// db.js"))).toMatchInlineSnapshot(`
        "// db.js
        var db;
        var init_db = __tlaNode(async () => {
          console.log("connecting");
          db = await { name: "db", size: 2 };
          console.log("connected");
          __tlaDone(init_db);
        }, 1, []);

        // api.js
        function find() {
          return db.name;
        }

        class Repo {
          all() {
            return [db.name];
          }
        }
        // limit.js
        var limit;
        var init_limit = __tlaNode(() => {
          limit = db.size * 2;
          console.log("limit");
        }, 0, [init_db]);
        // log.js
        console.log("log");

        // entry.js
        await __tlaMain([init_db, init_limit]);
        __tlaResume();
        console.log("entry", find(), new Repo().all(), limit);
        "
      `);
    },
  });

  // In an import cycle the file that the walk leaves last stands for the others, so it keeps its wrapper.
  order(
    "ModuleThatEvaluatesNothingInACycle",
    {
      "/entry.js": `
        import "./root.js";
        import "./outside.js";
        console.log("entry");
      `,
      "/root.js": `
        import "./member.js";
        import "./slow.js";
        export function root() {}
      `,
      "/member.js": `
        import { root } from "./root.js";
        console.log("member", typeof root);
      `,
      "/outside.js": `
        import "./member.js";
        console.log("outside");
      `,
      "/slow.js": `
        console.log("slow 1");
        await 0;
        console.log("slow 2");
      `,
    },
    "member function\nslow 1\nslow 2\noutside\nentry",
  );

  // The entry point can only stay unwrapped if the chunk's top level is certain to be waiting when the last body ends.
  itBundled("tla/EntryPointIsWrappedWhenNoBodyIsCertainToSuspend", {
    files: {
      "/entry.js": `
        import "./t.js";
        import "./b.js";
        console.log("entry");
      `,
      "/t.js": `
        console.log("t");
        if (globalThis.never) await 0;
      `,
      "/b.js": `
        console.log("b");
        Promise.resolve().then(() => console.log("job of b"));
      `,
    },
    format: "esm",
    target: "bun",
    run: { stdout: "t\nb\nentry\njob of b" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("await __tlaWait(init_entry);");
    },
  });

  itBundled("tla/Minified", {
    files: diamond,
    format: "esm",
    target: "bun",
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: { stdout: diamondStdout },
  });

  itBundled("tla/MinifiedBehindImportCall", {
    files: { "/outer.js": `await import("./entry.js"); console.log("imported");`, ...diamond },
    format: "esm",
    target: "bun",
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: { stdout: diamondStdout + "\nimported" },
  });

  // The chunk's own top level is the entry point's, as before.
  itBundled("tla/OnlyTheEntryPointAwaits", {
    files: {
      "/entry.js": `
        import { a } from "./a.js";
        console.log(await a);
      `,
      "/a.js": `export const a = "a";`,
    },
    format: "esm",
    target: "bun",
    run: { stdout: "a" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__tla");
    },
  });

  // Tree shaking drops pkg, and nothing is left to wait for.
  itBundled("tla/UnusedModuleWithAwaitIsDropped", {
    files: {
      "/entry.js": `
        import { x } from "pkg";
        import { y } from "./mid.js";
        console.log("entry", y);
      `,
      "/mid.js": `
        import { x } from "pkg";
        export const y = "mid";
        console.log("mid");
      `,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js", "sideEffects": false }`,
      "/node_modules/pkg/index.js": `
        console.log("pkg");
        export const x = await 1;
      `,
    },
    format: "esm",
    target: "bun",
    run: { stdout: "mid\nentry mid" },
  });

  itBundled("tla/UnusedReExportOfAModuleWithAwaitIsDropped", {
    files: {
      "/entry.js": `
        import { x } from "pkg";
        console.log("entry", x);
      `,
      "/node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js", "sideEffects": false }`,
      "/node_modules/pkg/index.js": `
        export * from "./a.js";
        export * from "./db.js";
      `,
      "/node_modules/pkg/a.js": `export const x = "X";`,
      "/node_modules/pkg/db.js": `
        console.log("connecting");
        export const db = await 1;
      `,
    },
    format: "esm",
    target: "bun",
    run: { stdout: "entry X" },
  });

  // What --define and dead code elimination leave behind is an ordinary synchronous module.
  itBundled("tla/AwaitInDeadCodeDoesNotCount", {
    files: {
      "/entry.js": `
        import { config } from "./a.js";
        console.log("entry", config);
      `,
      "/a.js": `export { config } from "./config.js";`,
      "/config.js": `
        export let config = "production";
        if (MODE === "development") config = (await import("./dev.js")).config;
      `,
      "/dev.js": `export const config = "development";`,
    },
    define: { MODE: '"production"' },
    format: "esm",
    target: "bun",
    run: { stdout: "entry production" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("await");
      api.expectFile("/out.js").not.toContain("__tla");
    },
  });

  // A lowered `using` puts the rest of the file, exports included, into a try block.
  for (const target of ["node", "bun"] as const) {
    itBundled("tla/UsingInAModuleThatWaits_" + target, {
      files: {
        "/entry.js": `
          import { v, f, K } from "./a.js";
          console.log("entry", v, f(), typeof K);
        `,
        "/a.js": `
          import { t } from "./t.js";
          using x = { [Symbol.dispose]() { console.log("disposed"); } };
          export const v = 3 + t;
          export function f() { return v; }
          export class K {}
          console.log("a");
        `,
        "/t.js": `export const t = await "T";`,
      },
      format: "esm",
      target,
      run: { stdout: "a\ndisposed\nentry 3T 3T function" },
    });
  }

  // No body is certain to suspend, so the entry point is wrapped. The export statement stays outside.
  itBundled("tla/ExportStarFromExternalInAWrappedEntryPoint", {
    files: {
      "/entry.js": `
        import { t } from "./t.js";
        export * from "node:path";
        console.log("entry", t);
      `,
      "/t.js": `
        export const t = "T";
        if (globalThis.never) await 0;
      `,
    },
    format: "esm",
    target: "bun",
    runtimeFiles: {
      "/runner.js": `const ns = await import("./out.js"); console.log(typeof ns.basename);`,
    },
    run: { file: "/runner.js", stdout: "entry T\nfunction" },
  });

  // Each chunk has its own walk: a.js is the entry point of one and in the middle of the other.
  itBundled("tla/EntryPointImportsAnotherEntryPoint", {
    files: {
      "/a.js": `
        import { t } from "./t.js";
        import "./s.js";
        console.log("a", t);
        export const a = "A" + t;
      `,
      "/b.js": `
        import "./s.js";
        import { a } from "./a.js";
        console.log("b", a);
      `,
      "/t.js": `
        console.log("t1");
        export const t = await "T";
        console.log("t2");
      `,
      "/s.js": `console.log("s");`,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    format: "esm",
    target: "bun",
    run: [
      { file: "/out/a.js", stdout: "t1\ns\nt2\na T" },
      { file: "/out/b.js", stdout: "s\nt1\nt2\na T\nb AT" },
    ],
  });

  // import statements are hoisted, wherever they are written.
  itBundled("tla/ImportStatementsBehindCode", {
    files: {
      "/entry.js": `
        console.log("entry 1", typeof t, typeof c);
        import { t } from "./t.js";
        console.log("entry 2", t);
        import c from "./c.cjs";
        export * from "./s.js";
        console.log("entry 3", c.v);
        import "./z.js";
      `,
      "/t.js": `
        console.log("t1");
        export const t = await "T";
        console.log("t2");
      `,
      "/c.cjs": `
        console.log("cjs");
        exports.v = 1;
      `,
      "/s.js": `
        console.log("s");
        export const s = 1;
      `,
      "/z.js": `console.log("z");`,
    },
    format: "esm",
    target: "bun",
    run: { stdout: "t1\ncjs\ns\nz\nt2\nentry 1 string object\nentry 2 T\nentry 3 1" },
  });

  // Random graphs (tla-fuzz/README.md). The bundle logs what a transcription of the specification's algorithms logs
  // for the same graph: every step of every module, in the same promise job.
  for (const [profile, seeds] of Object.entries({
    dag: [4, 36],
    cyc: [43, 67],
    err: [36, 109],
    err2: [20, 41],
    inert: [20, 36],
    time: [4, 30],
    sig: [36, 41],
    dyn: [20, 43],
  })) {
    for (const seed of seeds) {
      test.concurrent(`tla/RandomGraph ${profile} ${seed}`, async () => {
        const { bundle, model } = await checkGraph(bunExe(), profile, seed);
        expect(bundle).toEqual(model);
      });
    }
  }
});
