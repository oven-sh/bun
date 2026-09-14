import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { ModuleGraph } = Bun.unsafe as any;

// A graph whose modules can call `log(event)`; the events land in `events`.
function graphWithLog(extraGlobals: Record<string, unknown> = {}) {
  const events: string[] = [];
  const graph = new ModuleGraph({ globals: { log: (event: string) => void events.push(event), ...extraGlobals } });
  return { graph, events };
}

const settled = (promise: Promise<unknown>) =>
  promise.then(
    value => ({ status: "fulfilled" as const, value }),
    reason => ({ status: "rejected" as const, reason }),
  );

async function until(condition: () => boolean) {
  while (!condition()) await new Promise(resolve => setImmediate(resolve));
}

describe("Bun.unsafe.ModuleGraph linking", () => {
  describe("import cycles", () => {
    const twoModuleCycle = {
      "cycle-a.mjs": `
        import { b, readA } from "./cycle-b.mjs";
        log("a:start");
        export function hoisted() { return "hoisted in a"; }
        export let a = "a-value";
        export const readB = () => b;
        export { readA };
        log("a:end");
      `,
      "cycle-b.mjs": `
        import { a, hoisted } from "./cycle-a.mjs";
        log("b:start");
        export const calledBeforeExporterEvaluated = hoisted();
        export let tdz;
        try {
          tdz = String(a);
        } catch (error) {
          tdz = [error.constructor === ReferenceError, error instanceof ReferenceError];
        }
        export const b = "b-value";
        export const readA = () => a;
        log("b:end");
      `,
    };

    test("two modules: hoisted function works and a `let` is in its TDZ before the exporter evaluated", async () => {
      using dir = tempDir("module-graph-linking-cycle2", twoModuleCycle);
      const { graph, events } = graphWithLog();
      using _ = graph;

      const a = await graph.import(join(String(dir), "cycle-a.mjs"));
      const b = await graph.import(join(String(dir), "cycle-b.mjs"));
      expect({
        events,
        calledBeforeExporterEvaluated: b.calledBeforeExporterEvaluated,
        tdz: b.tdz,
        readA: b.readA(),
        readB: a.readB(),
        reExportIsSameFunction: a.readA === b.readA,
      }).toEqual({
        events: ["b:start", "b:end", "a:start", "a:end"],
        calledBeforeExporterEvaluated: "hoisted in a",
        tdz: [true, true],
        readA: "a-value",
        readB: "b-value",
        reExportIsSameFunction: true,
      });
    });

    test("the module a cycle is entered through evaluates last, per graph", async () => {
      using dir = tempDir("module-graph-linking-cycle-entry", twoModuleCycle);
      const fromA = graphWithLog();
      const fromB = graphWithLog();
      using _a = fromA.graph;
      using _b = fromB.graph;

      const inA = await fromA.graph.import(join(String(dir), "cycle-a.mjs"));
      const inB = await fromB.graph.import(join(String(dir), "cycle-b.mjs"));
      expect({
        fromA: fromA.events,
        fromB: fromB.events,
        // Entered through b, a evaluates first and b's bindings are the ones in their TDZ.
        tdzInB: (await fromB.graph.import(join(String(dir), "cycle-b.mjs"))).tdz,
        sameInstance: inA.readA === inB.readA,
      }).toEqual({
        fromA: ["b:start", "b:end", "a:start", "a:end"],
        fromB: ["a:start", "a:end", "b:start", "b:end"],
        tdzInB: "a-value",
        sameInstance: false,
      });
    });

    test("three modules", async () => {
      using dir = tempDir("module-graph-linking-cycle3", {
        "ring-a.mjs": `
          import { fromB } from "./ring-b.mjs";
          log("a");
          export function fromA() { return "A"; }
          export const viaB = fromB();
        `,
        "ring-b.mjs": `
          import { fromC } from "./ring-c.mjs";
          log("b");
          export function fromB() { return "B" + fromC(); }
        `,
        "ring-c.mjs": `
          import { fromA, viaB } from "./ring-a.mjs";
          log("c");
          export function fromC() { return "C" + fromA(); }
          export const early = fromA();
          export const readViaB = () => viaB;
          export let viaBWasInTDZ = false;
          try { readViaB(); } catch (error) { viaBWasInTDZ = error instanceof ReferenceError; }
        `,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;

      const a = await graph.import(join(String(dir), "ring-a.mjs"));
      const c = await graph.import(join(String(dir), "ring-c.mjs"));
      expect({ events, viaB: a.viaB, early: c.early, viaBWasInTDZ: c.viaBWasInTDZ, readViaB: c.readViaB() }).toEqual({
        events: ["c", "b", "a"],
        viaB: "BCA",
        early: "A",
        viaBWasInTDZ: true,
        readViaB: "BCA",
      });
    });

    test("the same cycle in two graphs and the host is three independent cycles", async () => {
      using dir = tempDir("module-graph-linking-cycle-independent", {
        "journal.mjs": `export const entries = [];`,
        "ping.mjs": `
          import { entries } from "./journal.mjs";
          import { pong, pongCount } from "./pong.mjs";
          entries.push("ping");
          export let pingCount = 0;
          export function ping(n) { pingCount++; return n > 0 ? pong(n - 1) : "ping"; }
          export const counts = () => [pingCount, pongCount];
          export { entries };
        `,
        "pong.mjs": `
          import { entries } from "./journal.mjs";
          import { ping, pingCount } from "./ping.mjs";
          entries.push("pong");
          export let pongCount = 0;
          export function pong(n) { pongCount++; return n > 0 ? ping(n - 1) : "pong"; }
          export { pingCount };
        `,
      });
      const file = join(String(dir), "ping.mjs");

      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, host] = await Promise.all([a.import(file), b.import(file), import(file)]);

      expect([inA.ping(4), inB.ping(1), host.ping(0)]).toEqual(["ping", "pong", "ping"]);
      expect({
        a: inA.counts(),
        b: inB.counts(),
        host: host.counts(),
        entries: [inA.entries, inB.entries, host.entries],
        distinctEntries: new Set([inA.entries, inB.entries, host.entries]).size,
      }).toEqual({
        a: [3, 2],
        b: [1, 1],
        host: [1, 0],
        entries: [
          ["pong", "ping"],
          ["pong", "ping"],
          ["pong", "ping"],
        ],
        distinctEntries: 3,
      });
    });

    test("a module that imports itself", async () => {
      using dir = tempDir("module-graph-linking-self-import", {
        "selfish.mjs": `
          import * as self from "./selfish.mjs";
          import { value as own } from "./selfish.mjs";
          export let value = 1;
          export const bump = () => ++value;
          export const read = () => [self.value, own];
          export { self };
        `,
      });
      const file = join(String(dir), "selfish.mjs");
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(file);
      const inB = await b.import(file);
      inA.bump();
      expect({
        selfIsNamespace: [inA.self === inA, inB.self === inB, inA.self === inB.self],
        a: inA.read(),
        b: inB.read(),
      }).toEqual({ selfIsNamespace: [true, true, false], a: [2, 2], b: [1, 1] });
    });

    test("reading a namespace property whose binding is in its TDZ throws, per graph", async () => {
      using dir = tempDir("module-graph-linking-cycle-namespace-tdz", {
        "outer.mjs": `
          import "./inner.mjs";
          export const late = "late";
          export function early() { return "early"; }
        `,
        "inner.mjs": `
          import * as outer from "./outer.mjs";
          export const observed = { keys: Reflect.ownKeys(outer).slice(0, 2), early: outer.early() };
          try { outer.late; } catch (error) { observed.late = error.name; }
          try { Object.getOwnPropertyDescriptor(outer, "late"); } catch (error) { observed.descriptor = error.name; }
          try { Object.keys(outer); } catch (error) { observed.objectKeys = error.name; }
          observed.has = "late" in outer;
          export const readLate = () => outer.late;
        `,
      });
      using graph = new ModuleGraph();
      await graph.import(join(String(dir), "outer.mjs"));
      const inner = await graph.import(join(String(dir), "inner.mjs"));
      expect({ ...inner.observed, afterwards: inner.readLate() }).toEqual({
        keys: ["early", "late"],
        early: "early",
        late: "ReferenceError",
        descriptor: "ReferenceError",
        objectKeys: "ReferenceError",
        has: true,
        afterwards: "late",
      });
    });
  });

  describe("bindings", () => {
    test("an exported `let` is a live binding, per graph", async () => {
      using dir = tempDir("module-graph-linking-live", {
        "source.mjs": `
          export let value = "initial";
          export let count = 0;
          export function set(next) { value = next; count++; }
        `,
        "reader.mjs": `
          import { value, count } from "./source.mjs";
          import * as source from "./source.mjs";
          export const read = () => [value, count, source.value, source.count];
        `,
        "writer.mjs": `export { set } from "./source.mjs";`,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const readers = [
        await a.import(join(String(dir), "reader.mjs")),
        await b.import(join(String(dir), "reader.mjs")),
        await import(join(String(dir), "reader.mjs")),
      ];
      (await a.import(join(String(dir), "writer.mjs"))).set("from a");
      (await a.import(join(String(dir), "writer.mjs"))).set("from a again");
      (await b.import(join(String(dir), "writer.mjs"))).set("from b");

      expect(readers.map(reader => reader.read())).toEqual([
        ["from a again", 2, "from a again", 2],
        ["from b", 1, "from b", 1],
        ["initial", 0, "initial", 0],
      ]);
    });

    test("live bindings survive a chain of re-exports", async () => {
      using dir = tempDir("module-graph-linking-reexport-chain", {
        "origin.mjs": `
          export let level = 0;
          export const raise = () => ++level;
          export default "origin default";
        `,
        "hop1.mjs": `export { level as renamedOnce, raise, default as originDefault } from "./origin.mjs";`,
        "hop2.mjs": `export * from "./hop1.mjs";`,
        "hop3.mjs": `
          import { renamedOnce } from "./hop2.mjs";
          export { renamedOnce as renamedTwice, raise, originDefault as default } from "./hop2.mjs";
          export const viaImport = () => renamedOnce;
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(join(String(dir), "hop3.mjs"));
      const inB = await b.import(join(String(dir), "hop3.mjs"));
      inA.raise();
      inA.raise();
      inB.raise();
      const originInA = await a.import(join(String(dir), "origin.mjs"));

      expect({
        a: [inA.renamedTwice, inA.viaImport(), inA.default, Object.keys(inA)],
        b: [inB.renamedTwice, inB.viaImport(), inB.default, Object.keys(inB)],
        sameFunctionThroughTheChain: inA.raise === originInA.raise,
        originLevel: originInA.level,
      }).toEqual({
        a: [2, 2, "origin default", ["default", "raise", "renamedTwice", "viaImport"]],
        b: [1, 1, "origin default", ["default", "raise", "renamedTwice", "viaImport"]],
        sameFunctionThroughTheChain: true,
        originLevel: 2,
      });
    });

    test("`export *` skips `default` and lets a local export win", async () => {
      using dir = tempDir("module-graph-linking-star", {
        "star-source.mjs": `
          export default "source default";
          export const shadowed = "from source";
          export const kept = "kept";
        `,
        "star.mjs": `
          export * from "./star-source.mjs";
          export const shadowed = "local";
        `,
      });
      using graph = new ModuleGraph();
      const star = await graph.import(join(String(dir), "star.mjs"));
      expect({ ...star }).toEqual({ kept: "kept", shadowed: "local" });
      expect("default" in star).toBe(false);
    });

    test("`export * as ns` is the graph's namespace of that module", async () => {
      using dir = tempDir("module-graph-linking-star-as", {
        "inner-ns.mjs": `
          export let hits = 0;
          export const hit = () => ++hits;
          export default "inner default";
        `,
        "outer-ns.mjs": `
          export * as inner from "./inner-ns.mjs";
          import * as imported from "./inner-ns.mjs";
          export { imported };
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(join(String(dir), "outer-ns.mjs"));
      const inB = await b.import(join(String(dir), "outer-ns.mjs"));
      inA.inner.hit();
      expect({
        sameAsImportStar: inA.inner === inA.imported,
        sameAsGraphImport: inA.inner === (await a.import(join(String(dir), "inner-ns.mjs"))),
        sameAcrossGraphs: inA.inner === inB.inner,
        hits: [inA.inner.hits, inB.inner.hits],
        default: inA.inner.default,
      }).toEqual({
        sameAsImportStar: true,
        sameAsGraphImport: true,
        sameAcrossGraphs: false,
        hits: [1, 0],
        default: "inner default",
      });
    });

    test("a name that two `export *` disagree on is left out of the namespace", async () => {
      using dir = tempDir("module-graph-linking-star-conflict", {
        "left.mjs": `export const clash = "left"; export const onlyLeft = 1;`,
        "right.mjs": `export const clash = "right"; export const onlyRight = 2;`,
        "both.mjs": `
          export * from "./left.mjs";
          export * from "./right.mjs";
        `,
      });
      using graph = new ModuleGraph();
      const both = await graph.import(join(String(dir), "both.mjs"));
      expect({ keys: Object.keys(both), clash: both.clash, hasClash: "clash" in both }).toEqual({
        keys: ["onlyLeft", "onlyRight"],
        clash: undefined,
        hasClash: false,
      });
    });

    test("importing an ambiguous star export by name is a SyntaxError that stays in its graph", async () => {
      using dir = tempDir("module-graph-linking-star-ambiguous", {
        "amb-left.mjs": `export const clash = "left";`,
        "amb-right.mjs": `export const clash = "right";`,
        "amb-both.mjs": `
          export * from "./amb-left.mjs";
          export * from "./amb-right.mjs";
        `,
        "amb-user.mjs": `
          import { clash } from "./amb-both.mjs";
          export const value = clash;
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const failure = await settled(a.import(join(String(dir), "amb-user.mjs")));
      expect(failure).toEqual({ status: "rejected", reason: expect.any(SyntaxError) });

      // The modules that did link are still usable in the same graph, and nothing leaked to another graph.
      const both = await a.import(join(String(dir), "amb-both.mjs"));
      const left = await b.import(join(String(dir), "amb-left.mjs"));
      expect([Object.keys(both), left.clash]).toEqual([[], "left"]);
    });

    test("the same binding reached through two `export *` paths is not ambiguous", async () => {
      using dir = tempDir("module-graph-linking-star-diamond", {
        "gem.mjs": `export let gem = "ruby"; export const recut = next => { gem = next; };`,
        "facet1.mjs": `export * from "./gem.mjs";`,
        "facet2.mjs": `export * from "./gem.mjs";`,
        "crown.mjs": `
          export * from "./facet1.mjs";
          export * from "./facet2.mjs";
        `,
      });
      using graph = new ModuleGraph();
      const crown = await graph.import(join(String(dir), "crown.mjs"));
      crown.recut("emerald");
      expect({ ...crown, recut: undefined }).toEqual({ gem: "emerald", recut: undefined });
    });

    test("importing a name a module does not export is a SyntaxError in that graph only", async () => {
      using dir = tempDir("module-graph-linking-missing-export", {
        "provider.mjs": `export const provided = "provided";`,
        "bad-consumer.mjs": `
          import { missing } from "./provider.mjs";
          export const value = missing;
        `,
        "good-consumer.mjs": `export { provided } from "./provider.mjs";`,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const failure = await settled(a.import(join(String(dir), "bad-consumer.mjs")));
      expect(failure).toEqual({ status: "rejected", reason: expect.any(SyntaxError) });
      expect(failure.reason.message).toContain("missing");

      const good = [
        await a.import(join(String(dir), "good-consumer.mjs")),
        await b.import(join(String(dir), "good-consumer.mjs")),
        await import(join(String(dir), "good-consumer.mjs")),
      ];
      expect(good.map(ns => ns.provided)).toEqual(["provided", "provided", "provided"]);
    });

    test("default exports: expression, function, class, anonymous", async () => {
      using dir = tempDir("module-graph-linking-default", {
        "default-expression.mjs": `export default { made: "here" };`,
        "default-function.mjs": `export default function named() { return "named"; }`,
        "default-class.mjs": `export default class Shape { static kind = "shape"; }`,
        "default-anonymous.mjs": `export default function () {}`,
        "default-arrow.mjs": `export default () => {};`,
        "defaults.mjs": `
          import expression from "./default-expression.mjs";
          import fn from "./default-function.mjs";
          import Shape from "./default-class.mjs";
          import anonymous from "./default-anonymous.mjs";
          import { default as arrow } from "./default-arrow.mjs";
          export { expression, fn, Shape, anonymous, arrow };
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(join(String(dir), "defaults.mjs"));
      const inB = await b.import(join(String(dir), "defaults.mjs"));
      expect({
        expression: inA.expression,
        names: [inA.fn.name, inA.Shape.name, inA.arrow.name],
        typeofAnonymous: typeof inA.anonymous,
        called: inA.fn(),
        kind: inA.Shape.kind,
        distinctPerGraph: ["expression", "fn", "Shape", "anonymous", "arrow"].map(key => inA[key] !== inB[key]),
        sameAsGraphImport: (await a.import(join(String(dir), "default-class.mjs"))).default === inA.Shape,
      }).toEqual({
        expression: { made: "here" },
        names: ["named", "Shape", "default"],
        typeofAnonymous: "function",
        called: "named",
        kind: "shape",
        distinctPerGraph: [true, true, true, true, true],
        sameAsGraphImport: true,
      });
    });

    test('`export { x as "string name" }`', async () => {
      using dir = tempDir("module-graph-linking-string-names", {
        "string-exporter.mjs": `
          let counter = 0;
          const bump = () => ++counter;
          export { counter as "the counter", bump as "bump it!", counter as " " };
        `,
        "string-importer.mjs": `
          import { "the counter" as counter, "bump it!" as bump } from "./string-exporter.mjs";
          export { " " as "re-exported space" } from "./string-exporter.mjs";
          export const read = () => counter;
          export { bump };
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(join(String(dir), "string-importer.mjs"));
      const inB = await b.import(join(String(dir), "string-importer.mjs"));
      const exporterInA = await a.import(join(String(dir), "string-exporter.mjs"));
      inA.bump();
      inA.bump();
      expect({
        exporterKeys: Object.keys(exporterInA),
        exporter: [exporterInA["the counter"], exporterInA[" "], exporterInA["bump it!"] === inA.bump],
        a: [inA.read(), inA["re-exported space"]],
        b: [inB.read(), inB["re-exported space"]],
      }).toEqual({
        exporterKeys: [" ", "bump it!", "the counter"],
        exporter: [2, 2, true],
        a: [2, 2],
        b: [0, 0],
      });
    });

    test("`export default function` and `export { x as default }` are live, `export default <expression>` is not", async () => {
      using dir = tempDir("module-graph-linking-default-live", {
        "default-live-function.mjs": `
          export default function original() { return "original"; }
          export const replace = () => { original = () => "replaced"; };
        `,
        "default-live-alias.mjs": `
          let counter = 1;
          export { counter as default };
          export const bump = () => ++counter;
        `,
        "default-snapshot.mjs": `
          let counter = 1;
          export default counter;
          export const bump = () => ++counter;
        `,
        "default-reader.mjs": `
          import fn, { replace } from "./default-live-function.mjs";
          import alias, { bump as bumpAlias } from "./default-live-alias.mjs";
          import snapshot, { bump as bumpSnapshot } from "./default-snapshot.mjs";
          export const read = () => [fn(), alias, snapshot];
          export const change = () => { replace(); bumpAlias(); bumpSnapshot(); };
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(join(String(dir), "default-reader.mjs"));
      const inB = await b.import(join(String(dir), "default-reader.mjs"));
      inA.change();
      expect({ a: inA.read(), b: inB.read() }).toEqual({ a: ["replaced", 2, 1], b: ["original", 1, 1] });
    });

    test("an imported binding cannot be assigned, even though the exporter can", async () => {
      using dir = tempDir("module-graph-linking-readonly-import", {
        "owner.mjs": `
          export let owned = "original";
          export const assign = next => { owned = next; };
        `,
        "borrower.mjs": `
          import * as owner from "./owner.mjs";
          export function tryAssign() {
            try { owner.owned = "stolen"; } catch (error) { return error.constructor === TypeError; }
          }
          export const read = () => owner.owned;
          export { assign } from "./owner.mjs";
        `,
      });
      using graph = new ModuleGraph();
      const borrower = await graph.import(join(String(dir), "borrower.mjs"));
      expect([borrower.tryAssign(), borrower.read()]).toEqual([true, "original"]);
      borrower.assign("reassigned");
      expect(borrower.read()).toBe("reassigned");
    });
  });

  describe("module instances", () => {
    test("byte-identical modules at different paths are different modules", async () => {
      const index = `
        export { name } from "./twin-dep.mjs";
        export let count = 0;
        export const increment = () => ++count;
        export const url = import.meta.url;
      `;
      using dir = tempDir("module-graph-linking-twins", {
        "first/twin.mjs": index,
        "first/twin-dep.mjs": `export const name = "first";`,
        "second/twin.mjs": index,
        "second/twin-dep.mjs": `export const name = "second";`,
      });
      const paths = [join(String(dir), "first", "twin.mjs"), join(String(dir), "second", "twin.mjs")];
      for (const globals of [undefined, { tenant: "a" }, { tenant: "b" }]) {
        using graph = new ModuleGraph({ globals });
        const [first, second] = [await graph.import(paths[0]), await graph.import(paths[1])];
        first.increment();
        expect({
          names: [first.name, second.name],
          counts: [first.count, second.count],
          urls: [first.url, second.url],
        }).toEqual({
          names: ["first", "second"],
          counts: [1, 0],
          urls: paths.map(path => pathToFileURL(path).href),
        });
      }
    });

    test("a graph created after a file changed loads the new source; existing instances keep theirs", async () => {
      using dir = tempDir("module-graph-linking-changed-file", {
        "changing.mjs": `export const version = "first";`,
      });
      const file = join(String(dir), "changing.mjs");
      using before = new ModuleGraph();
      const first = await before.import(file);
      fs.writeFileSync(file, `export const version = "second, and longer"; export const added = true;`);
      using after = new ModuleGraph();
      const second = await after.import(file);

      expect({
        before: { ...first },
        beforeAgain: { ...(await before.import(file)) },
        after: { ...second },
      }).toEqual({
        before: { version: "first" },
        beforeAgain: { version: "first" },
        after: { version: "second, and longer", added: true },
      });
    });

    test("a JSON module is an object per graph", async () => {
      using dir = tempDir("module-graph-linking-json", {
        "settings.json": `{ "list": [1, 2, 3] }`,
        "settings-reader.mjs": `
          import settings from "./settings.json";
          import * as namespace from "./settings.json";
          export { settings };
          export const sameThroughNamespace = namespace.default === settings;
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(join(String(dir), "settings-reader.mjs"));
      const inB = await b.import(join(String(dir), "settings-reader.mjs"));
      inA.settings.list.push(4);
      expect({
        a: inA.settings,
        b: inB.settings,
        sameThroughNamespace: [inA.sameThroughNamespace, inB.sameThroughNamespace],
        sameAsGraphImport: (await a.import(join(String(dir), "settings.json"))).default === inA.settings,
      }).toEqual({
        a: { list: [1, 2, 3, 4] },
        b: { list: [1, 2, 3] },
        sameThroughNamespace: [true, true],
        sameAsGraphImport: true,
      });
    });

    test("twenty graphs loading the same modules at once", async () => {
      using dir = tempDir("module-graph-linking-twenty", {
        "twenty-top.mjs": `
          import { token as left } from "./twenty-left.mjs";
          import { token as right } from "./twenty-right.mjs";
          export const result = [index, left === right, left.index];
        `,
        "twenty-left.mjs": `await null; export { token } from "./twenty-bottom.mjs";`,
        "twenty-right.mjs": `export { token } from "./twenty-bottom.mjs";`,
        "twenty-bottom.mjs": `export const token = { index }; await new Promise(resolve => setImmediate(resolve));`,
      });
      const graphs = Array.from({ length: 20 }, (_, index) => new ModuleGraph({ globals: { index } }));
      const namespaces = await Promise.all(graphs.map(graph => graph.import(join(String(dir), "twenty-top.mjs"))));
      expect(namespaces.map(ns => ns.result)).toEqual(graphs.map((_, index) => [index, true, index]));
      for (const graph of graphs) graph.dispose();
    });
  });

  describe("namespace objects", () => {
    test("are spec-shaped module namespace exotic objects in every graph", async () => {
      using dir = tempDir("module-graph-linking-namespace-shape", {
        "shape.mjs": `
          export const zebra = 1;
          export let apple = 2;
          export default 3;
          export function _underscore() {}
          export const Upper = 4;
          export const $dollar = 5;
        `,
      });
      const file = join(String(dir), "shape.mjs");
      using graph = new ModuleGraph();
      const describeNamespace = (ns: any) => ({
        keys: Object.keys(ns),
        ownKeys: Reflect.ownKeys(ns),
        tag: ns[Symbol.toStringTag],
        tagDescriptor: Object.getOwnPropertyDescriptor(ns, Symbol.toStringTag),
        toString: Object.prototype.toString.call(ns),
        extensible: Object.isExtensible(ns),
        sealed: Object.isSealed(ns),
        frozen: Object.isFrozen(ns),
        constDescriptor: Object.getOwnPropertyDescriptor(ns, "zebra"),
        letDescriptor: Object.getOwnPropertyDescriptor(ns, "apple"),
        set: Reflect.set(ns, "zebra", 100),
        defineSame: Reflect.defineProperty(ns, "zebra", { value: 1 }),
        defineOther: Reflect.defineProperty(ns, "zebra", { value: 2 }),
        defineNew: Reflect.defineProperty(ns, "fresh", { value: 1 }),
        deleteExisting: Reflect.deleteProperty(ns, "zebra"),
        deleteMissing: Reflect.deleteProperty(ns, "fresh"),
        setPrototypeToObject: Reflect.setPrototypeOf(ns, {}),
        zebra: ns.zebra,
      });

      const expected = {
        keys: ["$dollar", "Upper", "_underscore", "apple", "default", "zebra"],
        ownKeys: ["$dollar", "Upper", "_underscore", "apple", "default", "zebra", Symbol.toStringTag],
        tag: "Module",
        tagDescriptor: { value: "Module", writable: false, enumerable: false, configurable: false },
        toString: "[object Module]",
        extensible: false,
        sealed: true,
        frozen: false,
        constDescriptor: { value: 1, writable: true, enumerable: true, configurable: false },
        letDescriptor: { value: 2, writable: true, enumerable: true, configurable: false },
        set: false,
        defineSame: true,
        defineOther: false,
        defineNew: false,
        deleteExisting: false,
        deleteMissing: true,
        setPrototypeToObject: false,
        zebra: 1,
      };
      expect(describeNamespace(await graph.import(file))).toEqual(expected);
      expect(describeNamespace(await import(file))).toEqual(expected);
      expect(Object.getPrototypeOf(await graph.import(file))).toBe(Object.getPrototypeOf(await import(file)));
    });

    test("`import * as ns` is one object within a graph and a different one in every other graph", async () => {
      using dir = tempDir("module-graph-linking-namespace-identity", {
        "subject.mjs": `export const subject = {};`,
        "observer1.mjs": `
          import * as ns from "./subject.mjs";
          export { ns };
          export const dynamic = () => import("./subject.mjs");
        `,
        "observer2.mjs": `
          import * as ns from "./subject.mjs";
          export { ns };
          export * as starAs from "./subject.mjs";
        `,
      });
      const [subject, observer1, observer2] = ["subject.mjs", "observer1.mjs", "observer2.mjs"].map(name =>
        join(String(dir), name),
      );
      async function collect(load: (specifier: string) => Promise<any>) {
        const one = await load(observer1);
        const two = await load(observer2);
        return [one.ns, two.ns, two.starAs, await one.dynamic(), await load(subject)];
      }
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await collect(specifier => a.import(specifier));
      const inB = await collect(specifier => b.import(specifier));
      const inHost = await collect(specifier => import(specifier));

      expect([inA, inB, inHost].map(all => new Set(all).size)).toEqual([1, 1, 1]);
      expect(new Set([inA[0], inB[0], inHost[0]]).size).toBe(3);
      expect(new Set([inA[0].subject, inB[0].subject, inHost[0].subject]).size).toBe(3);
    });
  });

  describe("evaluation order", () => {
    test("is post-order and each module evaluates once per graph", async () => {
      using dir = tempDir("module-graph-linking-order", {
        "order-root.mjs": `
          log("root:before-imports-is-impossible");
          import "./order-left.mjs";
          import "./order-right.mjs";
          import "./order-left.mjs";
          log("root");
        `,
        "order-left.mjs": `
          import "./order-left-leaf.mjs";
          log("left");
        `,
        "order-left-leaf.mjs": `log("left-leaf");`,
        "order-right.mjs": `
          import "./order-right-leaf.mjs";
          import "./order-left-leaf.mjs";
          log("right");
        `,
        "order-right-leaf.mjs": `log("right-leaf");`,
      });
      const root = join(String(dir), "order-root.mjs");
      const first = graphWithLog();
      const second = graphWithLog();
      using _a = first.graph;
      using _b = second.graph;

      await first.graph.import(root);
      await first.graph.import(root);
      await first.graph.import(join(String(dir), "order-right.mjs"));
      await second.graph.import(join(String(dir), "order-right.mjs"));
      await second.graph.import(root);

      expect({ first: first.events, second: second.events }).toEqual({
        first: ["left-leaf", "left", "right-leaf", "right", "root:before-imports-is-impossible", "root"],
        second: ["right-leaf", "left-leaf", "right", "left", "root:before-imports-is-impossible", "root"],
      });
    });

    test("a diamond's shared dependency evaluates once per graph", async () => {
      using dir = tempDir("module-graph-linking-diamond", {
        "diamond-top.mjs": `
          import { token as left } from "./diamond-left.mjs";
          import { token as right } from "./diamond-right.mjs";
          import { token } from "./diamond-bottom.mjs";
          log("top");
          export const tokens = [left, right, token];
        `,
        "diamond-left.mjs": `log("left"); export { token } from "./diamond-bottom.mjs";`,
        "diamond-right.mjs": `log("right"); export { token } from "./diamond-bottom.mjs";`,
        "diamond-bottom.mjs": `log("bottom"); export const token = {};`,
      });
      const top = join(String(dir), "diamond-top.mjs");
      const a = graphWithLog();
      const b = graphWithLog();
      using _a = a.graph;
      using _b = b.graph;
      const inA = await a.graph.import(top);
      const inB = await b.graph.import(top);

      expect({
        a: a.events,
        b: b.events,
        oneTokenPerGraph: [new Set(inA.tokens).size, new Set(inB.tokens).size],
        tokensDifferAcrossGraphs: inA.tokens[0] !== inB.tokens[0],
      }).toEqual({
        a: ["bottom", "left", "right", "top"],
        b: ["bottom", "left", "right", "top"],
        oneTokenPerGraph: [1, 1],
        tokensDifferAcrossGraphs: true,
      });
    });

    test("a later entry point reuses what the graph already evaluated", async () => {
      using dir = tempDir("module-graph-linking-second-entry", {
        "entry-one.mjs": `import { id } from "./entry-shared.mjs"; log("one"); export { id };`,
        "entry-two.mjs": `import { id } from "./entry-shared.mjs"; log("two"); export { id };`,
        "entry-shared.mjs": `log("shared"); export const id = {};`,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const one = await graph.import(join(String(dir), "entry-one.mjs"));
      const two = await graph.import(join(String(dir), "entry-two.mjs"));
      expect({ events, sameId: one.id === two.id }).toEqual({ events: ["shared", "one", "two"], sameId: true });
    });

    test("function declarations are initialized before any module of the graph evaluates", async () => {
      using dir = tempDir("module-graph-linking-hoisting", {
        "hoist-main.mjs": `
          import { useHelper } from "./hoist-dep.mjs";
          export const result = useHelper();
          export function helper() { return "helper from main"; }
        `,
        "hoist-dep.mjs": `
          import { helper } from "./hoist-main.mjs";
          export const duringEvaluation = helper();
          export const useHelper = () => helper();
        `,
      });
      using graph = new ModuleGraph();
      const main = await graph.import(join(String(dir), "hoist-main.mjs"));
      const dep = await graph.import(join(String(dir), "hoist-dep.mjs"));
      expect([main.result, dep.duringEvaluation]).toEqual(["helper from main", "helper from main"]);
    });
  });

  describe("top-level await", () => {
    test("graph.import() settles once the awaiting module finished", async () => {
      using dir = tempDir("module-graph-linking-tla-basic", {
        "awaiting.mjs": `
          log("before");
          export let value = "not yet";
          value = await gate;
          log("after");
        `,
      });
      const gate = Promise.withResolvers<string>();
      const { graph, events } = graphWithLog({ gate: gate.promise });
      using _ = graph;

      let namespace: any;
      const pending = graph.import(join(String(dir), "awaiting.mjs")).then((ns: any) => (namespace = ns));
      await until(() => events.length === 1);
      expect({ events: [...events], settled: namespace !== undefined }).toEqual({ events: ["before"], settled: false });

      gate.resolve("the awaited value");
      await pending;
      expect({ events, value: namespace.value }).toEqual({ events: ["before", "after"], value: "the awaited value" });
    });

    test("an importer evaluates after its dependency's await completed", async () => {
      using dir = tempDir("module-graph-linking-tla-dependency", {
        "tla-leaf.mjs": `
          export let stage = "start";
          await null;
          stage = "after first await";
          await new Promise(resolve => setImmediate(resolve));
          stage = "done";
        `,
        "tla-middle.mjs": `
          import { stage } from "./tla-leaf.mjs";
          export const seenByMiddle = stage;
        `,
        "tla-top.mjs": `
          import { seenByMiddle } from "./tla-middle.mjs";
          import { stage } from "./tla-leaf.mjs";
          export const seen = [seenByMiddle, stage];
        `,
      });
      using graph = new ModuleGraph();
      const top = await graph.import(join(String(dir), "tla-top.mjs"));
      expect(top.seen).toEqual(["done", "done"]);
    });

    test("two graphs awaiting at the same time finish independently", async () => {
      using dir = tempDir("module-graph-linking-tla-concurrent", {
        "tla-gated.mjs": `
          import { mark } from "./tla-gated-dep.mjs";
          export const before = mark("before");
          export const awaited = await gate;
          export const after = mark("after");
        `,
        "tla-gated-dep.mjs": `
          const marks = [];
          export const mark = name => { marks.push(name); return [...marks]; };
        `,
      });
      const file = join(String(dir), "tla-gated.mjs");
      const gates = [Promise.withResolvers<string>(), Promise.withResolvers<string>()];
      using a = new ModuleGraph({ globals: { gate: gates[0].promise } });
      using b = new ModuleGraph({ globals: { gate: gates[1].promise } });

      const finished: string[] = [];
      const imports = Promise.all([
        a.import(file).then((ns: any) => (finished.push("a"), ns)),
        b.import(file).then((ns: any) => (finished.push("b"), ns)),
      ]);
      gates[1].resolve("b's value");
      await until(() => finished.length === 1);
      gates[0].resolve("a's value");
      const [inA, inB] = await imports;

      expect({
        finished,
        a: [inA.before, inA.awaited, inA.after],
        b: [inB.before, inB.awaited, inB.after],
      }).toEqual({
        finished: ["b", "a"],
        a: [["before"], "a's value", ["before", "after"]],
        b: [["before"], "b's value", ["before", "after"]],
      });
    });

    test("importing a module again while its await is pending gives the one instance", async () => {
      using dir = tempDir("module-graph-linking-tla-reimport", {
        "tla-pending.mjs": `
          log("evaluating");
          export const token = {};
          await gate;
          log("finished");
          export const dynamic = () => import("./tla-pending.mjs");
        `,
        "tla-pending-user.mjs": `
          import { token } from "./tla-pending.mjs";
          log("user");
          export { token };
        `,
      });
      const file = join(String(dir), "tla-pending.mjs");
      const gate = Promise.withResolvers<void>();
      const { graph, events } = graphWithLog({ gate: gate.promise });
      using _ = graph;

      const first = graph.import(file);
      await until(() => events.length === 1);
      const second = graph.import(file);
      const user = graph.import(join(String(dir), "tla-pending-user.mjs"));
      const third = graph.import(pathToFileURL(file).href);
      gate.resolve();
      const namespaces = await Promise.all([first, second, third]);
      namespaces.push(await namespaces[0].dynamic());

      expect({
        events,
        distinctNamespaces: new Set(namespaces).size,
        userSawTheSameToken: (await user).token === namespaces[0].token,
      }).toEqual({ events: ["evaluating", "finished", "user"], distinctNamespaces: 1, userSawTheSameToken: true });
    });

    test("siblings that await do not block each other; the parent waits for all of them", async () => {
      using dir = tempDir("module-graph-linking-tla-siblings", {
        "sib-parent.mjs": `
          import "./sib-slow.mjs";
          import "./sib-sync.mjs";
          import "./sib-fast.mjs";
          log("parent");
        `,
        "sib-slow.mjs": `log("slow:start"); await slowGate; log("slow:end");`,
        "sib-sync.mjs": `log("sync");`,
        "sib-fast.mjs": `log("fast:start"); await fastGate; log("fast:end");`,
      });
      const slowGate = Promise.withResolvers<void>();
      const fastGate = Promise.withResolvers<void>();
      const { graph, events } = graphWithLog({ slowGate: slowGate.promise, fastGate: fastGate.promise });
      using _ = graph;

      const pending = graph.import(join(String(dir), "sib-parent.mjs"));
      await until(() => events.length === 3);
      fastGate.resolve();
      await until(() => events.length === 4);
      slowGate.resolve();
      await pending;
      expect(events).toEqual(["slow:start", "sync", "fast:start", "fast:end", "slow:end", "parent"]);
    });

    test("in a cycle", async () => {
      using dir = tempDir("module-graph-linking-tla-cycle", {
        "tla-cycle-a.mjs": `
          import { b, readA } from "./tla-cycle-b.mjs";
          log("a:start");
          export const a = "a after " + b;
          await null;
          log("a:end");
          export { readA };
        `,
        "tla-cycle-b.mjs": `
          import { a } from "./tla-cycle-a.mjs";
          log("b:start");
          await gate;
          export const b = "b";
          export const readA = () => a;
          log("b:end");
        `,
      });
      const gate = Promise.withResolvers<void>();
      const { graph, events } = graphWithLog({ gate: gate.promise });
      using _ = graph;

      const throughA = graph.import(join(String(dir), "tla-cycle-a.mjs"));
      await until(() => events.length === 1);
      // b is suspended at its await and a has not started: importing b now waits for the whole cycle.
      const eventsWhenBSettled = graph.import(join(String(dir), "tla-cycle-b.mjs")).then(() => [...events]);
      gate.resolve();

      expect({
        a: (await throughA).readA(),
        eventsWhenBSettled: await eventsWhenBSettled,
      }).toEqual({
        a: "a after b",
        eventsWhenBSettled: ["b:start", "b:end", "a:start", "a:end"],
      });
    });

    test("a module can await another graph's and the host's instance of itself", async () => {
      using dir = tempDir("module-graph-linking-tla-nested", {
        "nesting-doll.mjs": `
          export const depth =
            typeof importElsewhere === "function" ? 1 + (await importElsewhere(import.meta.path)).depth : 0;
        `,
      });
      const file = join(String(dir), "nesting-doll.mjs");
      using inner = new ModuleGraph({ globals: { importElsewhere: (specifier: string) => import(specifier) } });
      using outer = new ModuleGraph({ globals: { importElsewhere: (specifier: string) => inner.import(specifier) } });
      const outerNamespace = await outer.import(file);
      expect([outerNamespace.depth, (await inner.import(file)).depth, (await import(file)).depth]).toEqual([2, 1, 0]);
    });

    test("a rejected await fails that graph's module for good and no other graph's", async () => {
      using dir = tempDir("module-graph-linking-tla-reject", {
        "tla-rejecting.mjs": `
          log("evaluating in " + label);
          export const before = "before";
          await Promise.reject(new Error("rejected in " + label));
          log("unreachable");
        `,
        "tla-rejecting-parent.mjs": `
          import "./tla-rejecting-sibling.mjs";
          import "./tla-rejecting.mjs";
          log("unreachable parent");
        `,
        "tla-rejecting-sibling.mjs": `log("sibling in " + label);`,
      });
      const file = join(String(dir), "tla-rejecting.mjs");
      const parent = join(String(dir), "tla-rejecting-parent.mjs");
      const a = graphWithLog({ label: "a" });
      const b = graphWithLog({ label: "b" });
      using _a = a.graph;
      using _b = b.graph;

      const viaParent = await settled(a.graph.import(parent));
      const direct = await settled(a.graph.import(file));
      const again = await settled(a.graph.import(parent));
      const inB = await settled(b.graph.import(file));

      expect(viaParent).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "rejected in a" }) });
      expect(inB).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "rejected in b" }) });
      expect({
        sameErrorEveryTime: [direct.reason === viaParent.reason, again.reason === viaParent.reason],
        a: a.events,
        b: b.events,
      }).toEqual({
        sameErrorEveryTime: [true, true],
        a: ["sibling in a", "evaluating in a"],
        b: ["evaluating in b"],
      });
    });

    test("a rejection reaches every importer that was waiting for it and nobody else", async () => {
      using dir = tempDir("module-graph-linking-tla-reject-shared", {
        "waits-one.mjs": `import "./slow-good.mjs"; import "./slow-bad.mjs"; log("one");`,
        "waits-two.mjs": `import "./slow-bad.mjs"; import "./slow-good.mjs"; log("two");`,
        "waits-three.mjs": `import "./slow-good.mjs"; log("three"); export const ok = true;`,
        "slow-good.mjs": `log("good:start"); await gate; log("good:end");`,
        "slow-bad.mjs": `log("bad:start"); await gate; throw new Error("slow-bad failed");`,
      });
      const gate = Promise.withResolvers<void>();
      const { graph, events } = graphWithLog({ gate: gate.promise });
      using _ = graph;

      const one = settled(graph.import(join(String(dir), "waits-one.mjs")));
      await until(() => events.length === 2);
      const two = settled(graph.import(join(String(dir), "waits-two.mjs")));
      const three = settled(graph.import(join(String(dir), "waits-three.mjs")));
      gate.resolve();
      const results = await Promise.all([one, two, three]);

      expect(results.map(result => result.status)).toEqual(["rejected", "rejected", "fulfilled"]);
      expect({
        message: results[0].reason.message,
        sameError: results[0].reason === results[1].reason,
        events,
      }).toEqual({
        message: "slow-bad failed",
        sameError: true,
        events: ["good:start", "bad:start", "good:end", "three"],
      });
    });

    test("a rejection in a cycle fails every module of the cycle", async () => {
      using dir = tempDir("module-graph-linking-tla-reject-cycle", {
        "rejecting-cycle-a.mjs": `
          import "./rejecting-cycle-b.mjs";
          log("a:start");
          await null;
          throw new Error("a rejected");
        `,
        "rejecting-cycle-b.mjs": `
          import "./rejecting-cycle-a.mjs";
          log("b:start");
          await null;
          log("b:end");
        `,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const throughA = await settled(graph.import(join(String(dir), "rejecting-cycle-a.mjs")));
      const thenB = await settled(graph.import(join(String(dir), "rejecting-cycle-b.mjs")));
      expect(throughA).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "a rejected" }) });
      expect({ sameError: thenB.reason === throughA.reason, events }).toEqual({
        sameError: true,
        events: ["b:start", "b:end", "a:start"],
      });
    });
  });

  describe("errors", () => {
    test("a module that throws while evaluating fails once per graph", async () => {
      using dir = tempDir("module-graph-linking-throw", {
        "thrower.mjs": `
          const where = typeof label === "string" ? label : "host";
          if (typeof log === "function") log("evaluating in " + where);
          export const before = "before";
          throw new Error("thrown in " + where);
        `,
      });
      const file = join(String(dir), "thrower.mjs");
      const a = graphWithLog({ label: "a" });
      const b = graphWithLog({ label: "b" });
      using _a = a.graph;
      using _b = b.graph;

      const first = await settled(a.graph.import(file));
      const second = await settled(a.graph.import(file));
      const third = await settled(a.graph.import(pathToFileURL(file).href));
      const inB = await settled(b.graph.import(file));
      const inHost = await settled(import(file));

      expect([first, inB, inHost]).toEqual([
        { status: "rejected", reason: expect.objectContaining({ message: "thrown in a" }) },
        { status: "rejected", reason: expect.objectContaining({ message: "thrown in b" }) },
        { status: "rejected", reason: expect.objectContaining({ message: "thrown in host" }) },
      ]);
      expect(first.reason).toBeInstanceOf(Error);
      expect({
        sameErrorEveryTime: [second.reason === first.reason, third.reason === first.reason],
        a: a.events,
        b: b.events,
      }).toEqual({ sameErrorEveryTime: [true, true], a: ["evaluating in a"], b: ["evaluating in b"] });
    });

    test.each([
      ["42"],
      ["null"],
      ["undefined"],
      ['"a string"'],
      ["Symbol.for('thrown symbol')"],
      ["{ thrown: 'object' }"],
    ])("a module that throws %s", async thrown => {
      using dir = tempDir("module-graph-linking-throw-value", {
        "throws-value.mjs": `
            log("evaluating");
            throw ${thrown};
          `,
      });
      const file = join(String(dir), "throws-value.mjs");
      const { graph, events } = graphWithLog();
      using _ = graph;
      const first = await settled(graph.import(file));
      const second = await settled(graph.import(file));
      expect({ first, sameReason: Object.is(first.reason, second.reason), events }).toEqual({
        first: { status: "rejected", reason: new Function(`return ${thrown}`)() },
        sameReason: true,
        events: ["evaluating"],
      });
    });

    test("after a failed import the graph keeps what did evaluate and can import more", async () => {
      using dir = tempDir("module-graph-linking-throw-recover", {
        "recover-entry.mjs": `
          import { id } from "./recover-dep.mjs";
          log("entry");
          throw new Error("entry failed");
        `,
        "recover-dep.mjs": `log("dep"); export const id = {}; export let uses = 0; export const use = () => ++uses;`,
        "recover-other.mjs": `
          import { id, use } from "./recover-dep.mjs";
          log("other");
          export const used = use();
          export { id };
        `,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const failure = await settled(graph.import(join(String(dir), "recover-entry.mjs")));
      const other = await graph.import(join(String(dir), "recover-other.mjs"));
      const dep = await graph.import(join(String(dir), "recover-dep.mjs"));

      expect(failure).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "entry failed" }) });
      expect({ events, used: other.used, uses: dep.uses, sameDep: other.id === dep.id }).toEqual({
        events: ["dep", "entry", "other"],
        used: 1,
        uses: 1,
        sameDep: true,
      });
      expect(graph.mainModule).toBe(join(String(dir), "recover-entry.mjs"));
    });

    test("a throwing dependency fails its importers with the same error and they never evaluate", async () => {
      using dir = tempDir("module-graph-linking-throw-dependency", {
        "importer-one.mjs": `import "./first-dep.mjs"; import "./throwing-dep.mjs"; import "./never-dep.mjs"; log("importer one");`,
        "importer-two.mjs": `import "./throwing-dep.mjs"; log("importer two");`,
        "first-dep.mjs": `log("first dep");`,
        "never-dep.mjs": `log("never dep");`,
        "throwing-dep.mjs": `log("throwing dep"); throw new RangeError("dependency failed");`,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const one = await settled(graph.import(join(String(dir), "importer-one.mjs")));
      const two = await settled(graph.import(join(String(dir), "importer-two.mjs")));
      const dep = await settled(graph.import(join(String(dir), "throwing-dep.mjs")));

      expect(one).toEqual({ status: "rejected", reason: expect.any(RangeError) });
      expect({
        sameError: [two.reason === one.reason, dep.reason === one.reason],
        events,
      }).toEqual({ sameError: [true, true], events: ["first dep", "throwing dep"] });

      // The sibling that was never reached is still importable.
      await graph.import(join(String(dir), "never-dep.mjs"));
      expect(events).toEqual(["first dep", "throwing dep", "never dep"]);
    });

    test("importing a module that depends on one that already failed", async () => {
      using dir = tempDir("module-graph-linking-throw-then-importer", {
        "already-failed.mjs": `log("failing"); throw new Error("failed earlier");`,
        "late-importer.mjs": `import "./late-importer-dep.mjs"; import "./already-failed.mjs"; log("late importer");`,
        "late-importer-dep.mjs": `log("late importer dep");`,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const direct = await settled(graph.import(join(String(dir), "already-failed.mjs")));
      const viaImporter = await settled(graph.import(join(String(dir), "late-importer.mjs")));
      expect(direct).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "failed earlier" }) });
      expect({ sameError: viaImporter.reason === direct.reason, events }).toEqual({
        sameError: true,
        events: ["failing", "late importer dep"],
      });
    });

    test("a module that failed in the host evaluates afresh in a graph", async () => {
      using dir = tempDir("module-graph-linking-throw-host-first", {
        "host-fails.mjs": `
          export const evaluatedWith = permit;
        `,
      });
      const file = join(String(dir), "host-fails.mjs");
      const inHost = await settled(import(file));
      using graph = new ModuleGraph({ globals: { permit: "permitted" } });
      const inGraph = await graph.import(file);
      expect(inHost).toEqual({ status: "rejected", reason: expect.any(ReferenceError) });
      expect(inGraph.evaluatedWith).toBe("permitted");
      expect((await settled(import(file))).reason).toBe(inHost.reason);
    });

    test("an error in a cycle fails every module of the cycle with the same error", async () => {
      using dir = tempDir("module-graph-linking-throw-cycle", {
        "failing-cycle-a.mjs": `
          import "./failing-cycle-b.mjs";
          log("a");
          throw new Error("a failed");
        `,
        "failing-cycle-b.mjs": `
          import "./failing-cycle-a.mjs";
          log("b");
          export const fine = true;
        `,
      });
      const a = graphWithLog();
      const b = graphWithLog();
      using _a = a.graph;
      using _b = b.graph;

      const throughA = await settled(a.graph.import(join(String(dir), "failing-cycle-a.mjs")));
      const thenB = await settled(a.graph.import(join(String(dir), "failing-cycle-b.mjs")));
      expect(throughA).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "a failed" }) });
      expect({ sameError: thenB.reason === throughA.reason, events: a.events }).toEqual({
        sameError: true,
        events: ["b", "a"],
      });

      // Entered through b in another graph: a evaluates first and throws, b never runs.
      const throughB = await settled(b.graph.import(join(String(dir), "failing-cycle-b.mjs")));
      expect(throughB).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "a failed" }) });
      expect({ differentError: throughB.reason !== throughA.reason, events: b.events }).toEqual({
        differentError: true,
        events: ["a"],
      });
    });

    test("the same file can fail in one graph and succeed in another and in the host", async () => {
      using dir = tempDir("module-graph-linking-throw-isolated", {
        "sometimes.mjs": `
          import { loaded } from "./sometimes-dep.mjs";
          if (typeof shouldThrow !== "undefined" && shouldThrow) throw new Error("told to throw");
          export const ok = loaded;
        `,
        "sometimes-dep.mjs": `export const loaded = "loaded";`,
      });
      const file = join(String(dir), "sometimes.mjs");
      using failing = new ModuleGraph({ globals: { shouldThrow: true } });
      using working = new ModuleGraph({ globals: { shouldThrow: false } });

      const results = [
        await settled(failing.import(file)),
        await settled(working.import(file)),
        await settled(import(file)),
        await settled(failing.import(file)),
      ];
      expect(
        results.map(result => (result.status === "fulfilled" ? (result.value as any).ok : result.reason.message)),
      ).toEqual(["told to throw", "loaded", "loaded", "told to throw"]);
      expect((await failing.import(join(String(dir), "sometimes-dep.mjs"))).loaded).toBe("loaded");
    });

    test("a SyntaxError in a dependency", async () => {
      using dir = tempDir("module-graph-linking-syntax-error", {
        "syntax-entry.mjs": `
          import "./syntax-good.mjs";
          import "./syntax-broken.mjs";
          log("entry");
        `,
        "syntax-good.mjs": `log("good"); export const good = true;`,
        "syntax-broken.mjs": `export const broken = ;`,
      });
      const entry = join(String(dir), "syntax-entry.mjs");
      const a = graphWithLog();
      const b = graphWithLog();
      using _a = a.graph;
      using _b = b.graph;

      const inHost = await settled(import(join(String(dir), "syntax-broken.mjs")));
      const first = await settled(a.graph.import(entry));
      const second = await settled(a.graph.import(entry));
      const broken = await settled(a.graph.import(join(String(dir), "syntax-broken.mjs")));
      expect(inHost.status).toBe("rejected");
      expect(
        [first, second, broken].map(result => [result.status, result.reason?.constructor, result.reason?.message]),
      ).toEqual(Array(3).fill(["rejected", inHost.reason.constructor, inHost.reason.message]));
      // Nothing evaluates when the graph of modules fails to load.
      expect(a.events).toEqual([]);

      const good = await a.graph.import(join(String(dir), "syntax-good.mjs"));
      const goodInB = await b.graph.import(join(String(dir), "syntax-good.mjs"));
      expect({ good: [good.good, goodInB.good], a: a.events, b: b.events }).toEqual({
        good: [true, true],
        a: ["good"],
        b: ["good"],
      });
    });

    test("a dependency that does not resolve", async () => {
      using dir = tempDir("module-graph-linking-missing", {
        "missing-entry.mjs": `
          import "./missing-good.mjs";
          import "./does-not-exist.mjs";
          log("entry");
        `,
        "missing-good.mjs": `log("good"); export const good = true;`,
        "missing-unrelated.mjs": `log("unrelated"); export const unrelated = true;`,
      });
      const entry = join(String(dir), "missing-entry.mjs");
      const a = graphWithLog();
      const b = graphWithLog();
      using _a = a.graph;
      using _b = b.graph;

      const inHost = await settled(import(entry));
      const first = await settled(a.graph.import(entry));
      const second = await settled(a.graph.import(entry));
      expect(inHost.status).toBe("rejected");
      expect(inHost.reason.message).toContain("does-not-exist.mjs");
      expect(
        [first, second].map(result => [result.status, result.reason?.constructor, result.reason?.message]),
      ).toEqual(Array(2).fill(["rejected", inHost.reason.constructor, inHost.reason.message]));
      expect(a.events).toEqual([]);

      const unrelated = await a.graph.import(join(String(dir), "missing-unrelated.mjs"));
      const good = await a.graph.import(join(String(dir), "missing-good.mjs"));
      const goodInB = await b.graph.import(join(String(dir), "missing-good.mjs"));
      expect({ values: [unrelated.unrelated, good.good, goodInB.good], a: a.events, b: b.events }).toEqual({
        values: [true, true, true],
        a: ["unrelated", "good"],
        b: ["good"],
      });
      expect(a.graph.mainModule).toBe(entry);
    });

    test("import() of a failed module inside the graph rejects with the graph's error", async () => {
      using dir = tempDir("module-graph-linking-throw-dynamic", {
        "dynamic-thrower.mjs": `log("thrower"); throw new Error("thrown once");`,
        "dynamic-catcher.mjs": `
          export const attempt = () => import("./dynamic-thrower.mjs").then(() => "fulfilled", error => error);
        `,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const catcher = await graph.import(join(String(dir), "dynamic-catcher.mjs"));
      const fromInside = await catcher.attempt();
      const fromOutside = await settled(graph.import(join(String(dir), "dynamic-thrower.mjs")));
      const fromInsideAgain = await catcher.attempt();

      expect(fromInside).toBeInstanceOf(Error);
      expect({
        message: fromInside.message,
        same: [fromOutside.reason === fromInside, fromInsideAgain === fromInside],
        events,
      }).toEqual({ message: "thrown once", same: [true, true], events: ["thrower"] });
    });
  });

  describe("dynamic import()", () => {
    test("resolves relative to the importing module and gives the graph's namespace", async () => {
      using dir = tempDir("module-graph-linking-dynamic-relative", {
        "nested/relative-loader.mjs": `
          import * as staticInner from "./inner-target.mjs";
          import * as staticOuter from "../outer-target.mjs";
          export { staticInner, staticOuter };
          export const inner = () => import("./inner-target.mjs");
          export const outer = () => import("../outer-target.mjs");
          export const computed = (directory, name) => import(directory + "/" + name + ".mjs");
        `,
        "nested/inner-target.mjs": `export const where = "nested/inner-target";`,
        "outer-target.mjs": `export const where = "outer-target";`,
      });
      using graph = new ModuleGraph();
      const loader = await graph.import(join(String(dir), "nested", "relative-loader.mjs"));
      const [inner, outer, computedInner, computedOuter] = await Promise.all([
        loader.inner(),
        loader.outer(),
        loader.computed(".", "inner-target"),
        loader.computed("..", "outer-target"),
      ]);
      const host = await import(join(String(dir), "outer-target.mjs"));

      expect({
        where: [inner.where, outer.where],
        sameAsStatic: [inner === loader.staticInner, outer === loader.staticOuter],
        sameWhenComputed: [computedInner === inner, computedOuter === outer],
        sameAsGraphImport: outer === (await graph.import(join(String(dir), "outer-target.mjs"))),
        sameAsHost: outer === host,
      }).toEqual({
        where: ["nested/inner-target", "outer-target"],
        sameAsStatic: [true, true],
        sameWhenComputed: [true, true],
        sameAsGraphImport: true,
        sameAsHost: false,
      });
    });

    test("of a module the host loaded first gives the graph's own instance", async () => {
      using dir = tempDir("module-graph-linking-dynamic-host-first", {
        "host-first.mjs": `
          export let count = 0;
          export const increment = () => ++count;
        `,
        "host-first-loader.mjs": `export const load = () => import("./host-first.mjs");`,
      });
      const host = await import(join(String(dir), "host-first.mjs"));
      host.increment();
      host.increment();
      host.increment();

      using graph = new ModuleGraph();
      const loaded = await (await graph.import(join(String(dir), "host-first-loader.mjs"))).load();
      const hostLoaded = await (await import(join(String(dir), "host-first-loader.mjs"))).load();
      expect({ graph: loaded.count, host: hostLoaded.count, hostIsHost: hostLoaded === host }).toEqual({
        graph: 0,
        host: 3,
        hostIsHost: true,
      });
      loaded.increment();
      expect([loaded.count, host.count]).toEqual([1, 3]);
    });

    test("from a graph function the host calls long after graph.import() finished", async () => {
      using dir = tempDir("module-graph-linking-dynamic-late", {
        "late-loader.mjs": `
          export const load = () => import("./late-target.mjs");
          export async function loadAfterAwaits() {
            await null;
            await new Promise(resolve => setImmediate(resolve));
            return import("./late-target.mjs");
          }
        `,
        "late-target.mjs": `log("late target"); export const id = {};`,
      });
      const a = graphWithLog();
      const b = graphWithLog();
      using _a = a.graph;
      using _b = b.graph;
      const loaderA = await a.graph.import(join(String(dir), "late-loader.mjs"));
      const loaderB = await b.graph.import(join(String(dir), "late-loader.mjs"));
      await new Promise(resolve => setImmediate(resolve));
      expect([a.events, b.events]).toEqual([[], []]);

      const fromTimer = await new Promise<any>(resolve => setTimeout(() => resolve(loaderA.load()), 0));
      const fromReaction = await Promise.resolve().then(() => loaderA.load());
      const afterAwaits = await loaderA.loadAfterAwaits();
      const inB = await loaderB.loadAfterAwaits();

      expect({
        distinctInA: new Set([fromTimer, fromReaction, afterAwaits]).size,
        sameAsGraphImport: fromTimer === (await a.graph.import(join(String(dir), "late-target.mjs"))),
        differsInB: inB !== fromTimer,
        events: [a.events, b.events],
      }).toEqual({
        distinctInA: 1,
        sameAsGraphImport: true,
        differsInB: true,
        events: [["late target"], ["late target"]],
      });
    });

    test("from timers, microtasks and promise reactions created by graph code", async () => {
      using dir = tempDir("module-graph-linking-dynamic-callbacks", {
        "callbacks.mjs": `
          export const fromTimeout = () => new Promise((resolve, reject) => {
            setTimeout(() => { import("./callback-target.mjs").then(resolve, reject); }, 0);
          });
          export const fromImmediate = () => new Promise((resolve, reject) => {
            setImmediate(() => { import("./callback-target.mjs").then(resolve, reject); });
          });
          export const fromNextTick = () => new Promise((resolve, reject) => {
            process.nextTick(() => { import("./callback-target.mjs").then(resolve, reject); });
          });
          export const fromMicrotask = () => new Promise((resolve, reject) => {
            queueMicrotask(() => { import("./callback-target.mjs").then(resolve, reject); });
          });
          export const fromReaction = () => Promise.resolve().then(() => { return import("./callback-target.mjs"); });
          export const fromRejectionReaction = () => Promise.reject(0).catch(() => { return import("./callback-target.mjs"); });
          export const fromFinally = () => {
            let result;
            return Promise.resolve().finally(() => { result = import("./callback-target.mjs"); }).then(() => result);
          };
        `,
        "callback-target.mjs": `log("callback target"); export const id = {};`,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const callbacks = await graph.import(join(String(dir), "callbacks.mjs"));

      const namespaces: Record<string, any> = {};
      for (const name of Object.keys(callbacks)) namespaces[name] = await callbacks[name]();
      const expected = await graph.import(join(String(dir), "callback-target.mjs"));

      expect(Object.keys(namespaces)).toEqual([
        "fromFinally",
        "fromImmediate",
        "fromMicrotask",
        "fromNextTick",
        "fromReaction",
        "fromRejectionReaction",
        "fromTimeout",
      ]);
      for (const name of Object.keys(namespaces)) expect([name, namespaces[name] === expected]).toEqual([name, true]);
      expect(events).toEqual(["callback target"]);
    });

    test("every way of spelling a module is the graph's one instance", async () => {
      using dir = tempDir("module-graph-linking-dynamic-spellings", {
        "spellings.mjs": `
          export const spellings = () => Promise.all([
            import("./spelled.mjs"),
            import(import.meta.dir + "/spelled.mjs"),
            import(new URL("./spelled.mjs", import.meta.url).href),
            import(import.meta.resolve("./spelled.mjs")),
            import(new URL("./spelled.mjs", import.meta.url)),
            import("./nowhere/../spelled.mjs"),
          ]);
        `,
        "spelled.mjs": `log("spelled"); export const id = {};`,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const namespaces = await (await graph.import(join(String(dir), "spellings.mjs"))).spellings();
      namespaces.push(await graph.import(pathToFileURL(join(String(dir), "spelled.mjs")).href));
      namespaces.push(await graph.import(join(String(dir), "spelled.mjs")));
      expect({ count: namespaces.length, distinct: new Set(namespaces).size, events }).toEqual({
        count: 8,
        distinct: 1,
        events: ["spelled"],
      });
    });

    test("of builtin modules gives the shared exports", async () => {
      using dir = tempDir("module-graph-linking-dynamic-builtin", {
        "dynamic-builtins.mjs": `
          export const load = async () => ({
            fs: (await import("node:fs")).default,
            join: (await import("node:path")).join,
            bareJoin: (await import("path")).join,
            bunFile: (await import("bun")).file,
          });
        `,
      });
      using graph = new ModuleGraph();
      const loaded = await (await graph.import(join(String(dir), "dynamic-builtins.mjs"))).load();
      expect(loaded.fs).toBe(fs);
      expect(loaded.join).toBe(join);
      expect(loaded.bareJoin).toBe(join);
      expect(loaded.bunFile).toBe(Bun.file);
    });

    test("that fails to resolve rejects and leaves the graph usable", async () => {
      using dir = tempDir("module-graph-linking-dynamic-missing", {
        "dynamic-missing.mjs": `
          export const missing = () => import("./not-there.mjs");
          export const present = () => import("./is-there.mjs");
        `,
        "is-there.mjs": `export const here = true;`,
      });
      using graph = new ModuleGraph();
      const loader = await graph.import(join(String(dir), "dynamic-missing.mjs"));
      const failure = await settled(loader.missing());
      expect(failure.status).toBe("rejected");
      expect(failure.reason.message).toContain("not-there.mjs");
      expect((await loader.present()).here).toBe(true);
      expect((await settled(loader.missing())).status).toBe("rejected");
    });

    test("in direct eval code belongs to the graph; in indirect eval and `new Function` code it belongs to the host", async () => {
      using dir = tempDir("module-graph-linking-dynamic-eval", {
        "evaluator.mjs": `
          const target = JSON.stringify(import.meta.dir + "/eval-target.mjs");
          export const direct = () => eval('import("./eval-target.mjs")');
          export const indirect = () => (0, eval)("import(" + target + ")");
          export const constructed = () => new Function("return import(" + target + ")")();
        `,
        "eval-target.mjs": `export const id = {};`,
      });
      using graph = new ModuleGraph();
      const evaluator = await graph.import(join(String(dir), "evaluator.mjs"));
      const inGraph = await graph.import(join(String(dir), "eval-target.mjs"));
      const inHost = await import(join(String(dir), "eval-target.mjs"));
      expect({
        direct: (await evaluator.direct()) === inGraph,
        indirect: (await evaluator.indirect()) === inHost,
        constructed: (await evaluator.constructed()) === inHost,
      }).toEqual({ direct: true, indirect: true, constructed: true });
    });

    test("belongs to the module whose code contains it, not to whoever calls it", async () => {
      using dir = tempDir("module-graph-linking-dynamic-owner", {
        "owner-caller.mjs": `
          export const call = fn => fn();
          export const callHost = () => hostImport(import.meta.dir + "/owner-target.mjs");
          export const load = () => import("./owner-target.mjs");
        `,
        "owner-target.mjs": `export const id = {};`,
      });
      const target = join(String(dir), "owner-target.mjs");
      const hostImport = (specifier: string) => import(specifier);
      using a = new ModuleGraph({ globals: { hostImport } });
      using b = new ModuleGraph({ globals: { hostImport } });
      const callerA = await a.import(join(String(dir), "owner-caller.mjs"));
      const callerB = await b.import(join(String(dir), "owner-caller.mjs"));
      const [inA, inB, inHost] = [await a.import(target), await b.import(target), await import(target)];

      expect({
        hostFunctionCalledByGraph: (await callerA.callHost()) === inHost,
        graphFunctionCalledByOtherGraph: (await callerB.call(callerA.load)) === inA,
        graphFunctionCalledByItsGraph: (await callerB.call(callerB.load)) === inB,
        hostFunctionPassedToGraph: (await callerA.call(() => import(target))) === inHost,
        distinct: new Set([inA, inB, inHost]).size,
      }).toEqual({
        hostFunctionCalledByGraph: true,
        graphFunctionCalledByOtherGraph: true,
        graphFunctionCalledByItsGraph: true,
        hostFunctionPassedToGraph: true,
        distinct: 3,
      });
    });

    test("of the module itself while it is evaluating resolves to its namespace", async () => {
      using dir = tempDir("module-graph-linking-dynamic-self", {
        "reentrant.mjs": `
          log("reentrant");
          export const self = import("./reentrant.mjs");
          export const viaGraph = graphImport(import.meta.path);
          export const otherViaGraph = graphImport(import.meta.dir + "/reentrant-other.mjs");
        `,
        "reentrant-other.mjs": `log("other"); export const other = true;`,
      });
      const events: string[] = [];
      using graph = new ModuleGraph({
        globals: {
          log: (event: string) => void events.push(event),
          graphImport: (specifier: string) => graph.import(specifier),
        },
      });
      const namespace = await graph.import(join(String(dir), "reentrant.mjs"));
      expect({
        self: (await namespace.self) === namespace,
        viaGraph: (await namespace.viaGraph) === namespace,
        other: (await namespace.otherViaGraph) === (await graph.import(join(String(dir), "reentrant-other.mjs"))),
        events,
      }).toEqual({ self: true, viaGraph: true, other: true, events: ["reentrant", "other"] });
    });

    test("after the ModuleGraph object was garbage collected", async () => {
      using dir = tempDir("module-graph-linking-dynamic-collected", {
        "collected-loader.mjs": `
          import * as statically from "./collected-target.mjs";
          export const load = async () => (await import("./collected-target.mjs")) === statically;
          export const loadNew = () => import("./collected-new.mjs");
        `,
        "collected-target.mjs": `export const id = {};`,
        "collected-new.mjs": `export const label = tenant;`,
      });
      async function loaders() {
        const graph = new ModuleGraph({ globals: { tenant: "collected tenant" } });
        const { load, loadNew } = await graph.import(join(String(dir), "collected-loader.mjs"));
        return { load, loadNew };
      }
      const { load, loadNew } = await loaders();
      Bun.gc(true);
      expect({ sameAsStatic: await load(), label: (await loadNew()).label }).toEqual({
        sameAsStatic: true,
        label: "collected tenant",
      });
    });

    test("during evaluation of a static importer sees the same instance", async () => {
      using dir = tempDir("module-graph-linking-dynamic-during-evaluation", {
        "during-main.mjs": `
          import { id } from "./during-dep.mjs";
          const dynamic = await import("./during-dep.mjs");
          export const observed = { sameId: dynamic.id === id };
          log("main");
        `,
        "during-dep.mjs": `log("dep"); export const id = {};`,
      });
      const { graph, events } = graphWithLog();
      using _ = graph;
      const main = await graph.import(join(String(dir), "during-main.mjs"));
      expect({ observed: main.observed, events }).toEqual({
        observed: { sameId: true },
        events: ["dep", "main"],
      });
    });
  });

  describe("many modules", () => {
    const chainLength = 120;
    const chain: Record<string, string> = {};
    for (let i = 0; i < chainLength; i++) {
      chain[`chain-${i}.mjs`] =
        i === chainLength - 1
          ? `log(${i}); export const depth = 0; export const bottom = {};`
          : `import { depth as next } from "./chain-${i + 1}.mjs"; export { bottom } from "./chain-${i + 1}.mjs"; log(${i}); export const depth = next + 1;`;
    }

    test(`a chain of ${chainLength} modules in three graphs`, async () => {
      using dir = tempDir("module-graph-linking-chain", chain);
      const graphs = [graphWithLog(), graphWithLog(), graphWithLog()];
      const tops = await Promise.all(graphs.map(({ graph }) => graph.import(join(String(dir), "chain-0.mjs"))));
      const middles = await Promise.all(graphs.map(({ graph }) => graph.import(join(String(dir), "chain-60.mjs"))));
      const descending = Array.from({ length: chainLength }, (_, i) => chainLength - 1 - i);

      expect({
        depths: tops.map(top => top.depth),
        middleDepths: middles.map(middle => middle.depth),
        bottomsPerGraph: tops.map((top, i) => top.bottom === middles[i].bottom),
        distinctBottoms: new Set(tops.map(top => top.bottom)).size,
      }).toEqual({
        depths: [119, 119, 119],
        middleDepths: [59, 59, 59],
        bottomsPerGraph: [true, true, true],
        distinctBottoms: 3,
      });
      for (const { graph, events } of graphs) {
        expect(events).toEqual(descending);
        graph.dispose();
      }
    });

    test("a fan of 100 modules over one shared base", async () => {
      const width = 100;
      const files: Record<string, string> = {
        "fan-base.mjs": `log("base"); export const token = {}; export let touched = 0; export const touch = () => ++touched;`,
      };
      const indices = Array.from({ length: width }, (_, i) => i);
      for (const i of indices) {
        files[`fan-leaf-${i}.mjs`] = `
          import { token, touch } from "./fan-base.mjs";
          touch();
          export const leaf = { token, index: ${i} };
        `;
      }
      files["fan-root.mjs"] = `
        ${indices.map(i => `import { leaf as leaf${i} } from "./fan-leaf-${i}.mjs";`).join("\n")}
        export { touched } from "./fan-base.mjs";
        export const leaves = [${indices.map(i => `leaf${i}`).join(", ")}];
      `;
      using dir = tempDir("module-graph-linking-fan", files);
      const root = join(String(dir), "fan-root.mjs");
      const a = graphWithLog();
      const b = graphWithLog();
      using _a = a.graph;
      using _b = b.graph;
      const [inA, inB] = await Promise.all([a.graph.import(root), b.graph.import(root)]);

      const summarize = (ns: any) => ({
        touched: ns.touched,
        indices: ns.leaves.map((leaf: any) => leaf.index),
        tokens: new Set(ns.leaves.map((leaf: any) => leaf.token)).size,
      });
      expect([summarize(inA), summarize(inB)]).toEqual(Array(2).fill({ touched: width, indices, tokens: 1 }));
      expect({ a: a.events, b: b.events, sameToken: inA.leaves[0].token === inB.leaves[0].token }).toEqual({
        a: ["base"],
        b: ["base"],
        sameToken: false,
      });
    });

    test("concurrent imports of overlapping module sets into one graph give single instances", async () => {
      const sharedCount = 24;
      const files: Record<string, string> = {};
      for (let i = 0; i < sharedCount; i++) {
        files[`overlap-shared-${i}.mjs`] = `
          ${i + 1 < sharedCount && i % 3 === 0 ? `import "./overlap-shared-${i + 1}.mjs";` : ""}
          log("shared ${i}");
          ${i % 4 === 0 ? "await null;" : ""}
          ${i % 8 === 0 ? "await new Promise(resolve => setImmediate(resolve));" : ""}
          export const token = { index: ${i} };
        `;
      }
      const entryCount = 8;
      for (let entry = 0; entry < entryCount; entry++) {
        const picks = Array.from({ length: 9 }, (_, k) => (entry * 3 + k) % sharedCount);
        files[`overlap-entry-${entry}.mjs`] = `
          ${picks.map(i => `import { token as token${i} } from "./overlap-shared-${i}.mjs";`).join("\n")}
          log("entry ${entry}");
          export const tokens = { ${picks.map(i => `${i}: token${i}`).join(", ")} };
        `;
      }
      using dir = tempDir("module-graph-linking-overlap", files);
      const entries = Array.from({ length: entryCount }, (_, entry) => join(String(dir), `overlap-entry-${entry}.mjs`));
      const { graph, events } = graphWithLog();
      using _ = graph;

      const namespaces = await Promise.all([...entries, ...entries].map(entry => graph.import(entry)));
      const tokensByIndex = new Map<string, Set<unknown>>();
      for (const ns of namespaces) {
        for (const [index, token] of Object.entries(ns.tokens)) {
          if (!tokensByIndex.has(index)) tokensByIndex.set(index, new Set());
          tokensByIndex.get(index)!.add(token);
        }
      }

      expect({
        sameNamespaceBothTimes: entries.map((_, i) => namespaces[i] === namespaces[i + entryCount]),
        tokensSeenPerSharedModule: [...new Set([...tokensByIndex.values()].map(tokens => tokens.size))],
        sharedModulesSeen: tokensByIndex.size,
        evaluations: [...events].sort(),
      }).toEqual({
        sameNamespaceBothTimes: Array(entryCount).fill(true),
        tokensSeenPerSharedModule: [1],
        sharedModulesSeen: sharedCount,
        evaluations: [
          ...Array.from({ length: entryCount }, (_, entry) => `entry ${entry}`),
          ...Array.from({ length: sharedCount }, (_, i) => `shared ${i}`),
        ].sort(),
      });
      for (const [index, tokens] of tokensByIndex) {
        expect([...tokens][0]).toBe((await graph.import(join(String(dir), `overlap-shared-${index}.mjs`))).token);
      }
    });

    test("the same module imported 30 times at once, into each of three graphs", async () => {
      using dir = tempDir("module-graph-linking-same-at-once", {
        "at-once.mjs": `
          import "./at-once-dep.mjs";
          log("at-once");
          await null;
          export const id = {};
        `,
        "at-once-dep.mjs": `log("at-once-dep");`,
      });
      const file = join(String(dir), "at-once.mjs");
      const graphs = [graphWithLog(), graphWithLog(), graphWithLog()];
      const namespaces = await Promise.all(
        Array.from({ length: 90 }, (_, i) => graphs[i % 3].graph.import(i % 2 ? file : pathToFileURL(file).href)),
      );
      expect({
        distinct: new Set(namespaces).size,
        perGraph: [0, 1, 2].map(g => new Set(namespaces.filter((_, i) => i % 3 === g)).size),
        events: graphs.map(({ events }) => events),
      }).toEqual({
        distinct: 3,
        perGraph: [1, 1, 1],
        events: Array(3).fill(["at-once-dep", "at-once"]),
      });
      for (const { graph } of graphs) graph.dispose();
    });
  });

  describe("what graphs share", () => {
    test("globalThis and the intrinsics are the host's", async () => {
      using dir = tempDir("module-graph-linking-intrinsics", {
        "intrinsics.mjs": `
          class Local {}
          async function asyncFunction() {}
          function* generator() {}
          export const intrinsics = {
            globalThis, Object, Function, Array, Promise, Error, TypeError, Symbol, Map, WeakRef, JSON, Math, Reflect, Proxy,
            console, process, Bun, Buffer, URL, Response, setTimeout, queueMicrotask, structuredClone,
            objectLiteralPrototype: Object.getPrototypeOf({}),
            arrayLiteralPrototype: Object.getPrototypeOf([]),
            regExpLiteralPrototype: Object.getPrototypeOf(/x/),
            functionPrototype: Object.getPrototypeOf(Local),
            asyncFunctionPrototype: Object.getPrototypeOf(asyncFunction),
            generatorPrototype: Object.getPrototypeOf(generator),
            promiseOfAsyncFunction: Object.getPrototypeOf(asyncFunction()),
            promiseOfImport: Object.getPrototypeOf(import("./intrinsics.mjs")),
            importMetaPrototype: Object.getPrototypeOf(import.meta),
            templateObjectPrototype: Object.getPrototypeOf((strings => strings)\`\`),
            registeredSymbol: Symbol.for("module-graph-linking"),
            iterator: Symbol.iterator,
          };
        `,
      });
      const file = join(String(dir), "intrinsics.mjs");
      using graph = new ModuleGraph({ globals: { unrelated: 1 } });
      const inGraph = (await graph.import(file)).intrinsics;
      const inHost = (await import(file)).intrinsics;

      expect(Object.keys(inGraph).filter(key => inGraph[key] !== inHost[key])).toEqual([]);
      expect(inGraph.globalThis).toBe(globalThis);
      expect(inGraph.promiseOfImport).toBe(Promise.prototype);
    });

    test("builtin modules expose the host's exports", async () => {
      using dir = tempDir("module-graph-linking-builtins", {
        "builtins.mjs": `
          import fs, { readFileSync } from "node:fs";
          import * as fsNamespace from "node:fs";
          import { join } from "node:path";
          import path from "path";
          import { EventEmitter } from "node:events";
          import { file as bunFile } from "bun";
          import { expect } from "bun:test";
          export { fs, readFileSync, join, path, EventEmitter, expect };
          export const fsNamespaceReadFileSync = fsNamespace.readFileSync;
          export { bunFile };
        `,
      });
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const inA = await a.import(join(String(dir), "builtins.mjs"));
      const inB = await b.import(join(String(dir), "builtins.mjs"));
      const inHost = await import(join(String(dir), "builtins.mjs"));

      expect(Object.keys(inHost).filter(key => inA[key] !== inHost[key] || inB[key] !== inHost[key])).toEqual([]);
      expect(inA.fs).toBe(fs);
      expect(inA.readFileSync).toBe(fs.readFileSync);
      expect(inA.join).toBe(join);
      expect(inA.bunFile).toBe(Bun.file);
      expect(inA.expect).toBe(expect);
      expect((await a.import("node:fs")).default).toBe(fs);
      expect(await a.import("node:fs")).toBe(await a.import("node:fs"));
    });

    test("a class defined in a module is a different class in every graph", async () => {
      using dir = tempDir("module-graph-linking-classes", {
        "shapes.mjs": `
          export class Shape {
            static instances = 0;
            #secret = "secret";
            constructor() { Shape.instances++; }
            static hasSecret(value) { return #secret in value; }
          }
          export class ShapeError extends Error {}
          export const make = () => new Shape();
          export const fail = () => { throw new ShapeError("bad shape"); };
          export const list = () => [new Shape()];
          export const local = Symbol("local");
          export const registered = Symbol.for("module-graph-linking-shapes");
        `,
      });
      const file = join(String(dir), "shapes.mjs");
      using a = new ModuleGraph();
      using b = new ModuleGraph();
      const [inA, inB, inHost] = [await a.import(file), await b.import(file), await import(file)];
      const fromA = inA.make();
      inA.make();
      let thrown: any;
      try {
        inA.fail();
      } catch (error) {
        thrown = error;
      }

      expect({
        distinctClasses: new Set([inA.Shape, inB.Shape, inHost.Shape]).size,
        instanceOf: [fromA instanceof inA.Shape, fromA instanceof inB.Shape, fromA instanceof inHost.Shape],
        privateBrand: [inA.Shape.hasSecret(fromA), inB.Shape.hasSecret(fromA), inHost.Shape.hasSecret(fromA)],
        instances: [inA.Shape.instances, inB.Shape.instances, inHost.Shape.instances],
        thrown: [
          thrown instanceof inA.ShapeError,
          thrown instanceof inB.ShapeError,
          thrown instanceof Error,
          Object.getPrototypeOf(inA.ShapeError) === Error,
        ],
        arrays: [
          inA.list() instanceof Array,
          Array.isArray(inA.list()),
          Object.getPrototypeOf(inA.list()) === Array.prototype,
        ],
        symbols: [inA.local === inB.local, inA.registered === inB.registered, inA.registered === inHost.registered],
      }).toEqual({
        distinctClasses: 3,
        instanceOf: [true, false, false],
        privateBrand: [true, false, false],
        instances: [2, 0, 0],
        thrown: [true, false, true, true],
        arrays: [true, true, true],
        symbols: [false, true, true],
      });
    });
  });
});
