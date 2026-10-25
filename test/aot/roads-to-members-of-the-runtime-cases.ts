import { describe, expect } from "bun:test";
import { runtimeUse } from "./runtime-use-harness";
import { eachRow, gap } from "./supported";

// By which roads does a program come to a member of Bun, of the global object, of process or of a node: module? Whatever the road, the list that trimming goes by keeps the code behind the member:
// a use that the list misses is an executable that throws where `bun run` does not.
// Each road is a program of its own: in one program a road that is followed would hide one that is not.
type Road = [extension: "mjs" | "cjs", text: string, reachesModule?: "by the name of the module" | "as a class", notYetForBun?: string];

// Bun is different (docs/bundler/aot-size.mdx, "What blocks --trim"): handing Bun on names no member of it. So where the compiler loses sight of Bun on its way, it does not see the use either.
const outOfSight = "the compiler does not follow Bun along this road: --trim removes the class, and `new` throws ERR_FEATURE_REMOVED";

const roadsToBunGlob: Road[] = [
  ["mjs", `console.log(new (Object.freeze(Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (Object.seal(Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (Object.preventExtensions(Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (Object(Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (Object.create(Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (new Proxy(Bun, {}).Glob)("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `console.log(new (globalThis["Bun"].Glob)("*.js").match("a.js"));`, "by the name of the module"],
  ["cjs", `console.log(new (module.require("bun").Glob)("*.js").match("a.js"));`, "by the name of the module"],
  ["mjs", `console.log(new (process.getBuiltinModule("bun").Glob)("*.js").match("a.js"));`, "by the name of the module"],
  ["mjs", `import { createRequire } from "node:module"; console.log(new (createRequire(import.meta.url)("bun").Glob)("*.js").match("a.js"));`, "by the name of the module"],
  ["mjs", `import * as b from "bun"; console.log(new b.Glob("*.js").match("a.js"));`, "by the name of the module"],
  ["mjs", `import b from "bun"; console.log(new b.Glob("*.js").match("a.js"));`, "by the name of the module"],
  ["mjs", `const { Glob } = await import("bun"); console.log(new Glob("*.js").match("a.js"));`, "by the name of the module"],
  ["mjs", `import("bun").then(b => console.log(new b.Glob("*.js").match("a.js")));`, "by the name of the module"],
  ["mjs", `console.log(Reflect.construct(Bun.Glob, ["*.js"]).match("a.js"));`, "as a class"],
  ["mjs", `console.log(new (Object.getOwnPropertyDescriptors(Bun).Glob.value)("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `for (const k in Bun) if (k === "Glob") console.log(new Bun[k]("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `console.log(new (Object.fromEntries(Object.entries(Bun)).Glob)("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `let saved; JSON.stringify({ b: Bun }, function (k, v) { if (k === "b") saved = v; return k === "" ? v : 1; }); console.log(new saved.Glob("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `console.log([Bun].map(b => new b.Glob("*.js").match("a.js"))[0]);`],
  ["mjs", `console.log(new (Array.from([Bun])[0].Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ([Bun].at(0).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ([...new Set([Bun])][0].Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (new WeakRef(Bun).deref().Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (Function.prototype.call.call(function () { return this; }, Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ((function () { return this.Glob; }).bind(Bun)())("*.js").match("a.js"));`],
  ["cjs", `with (Bun) { console.log(new Glob("*.js").match("a.js")); }`],
  ["mjs", `setTimeout(b => console.log(new b.Glob("*.js").match("a.js")), 0, Bun);`],
  ["mjs", `queueMicrotask((b => () => console.log(new b.Glob("*.js").match("a.js")))(Bun));`],
  ["mjs", `process.nextTick(b => console.log(new b.Glob("*.js").match("a.js")), Bun);`],
  ["mjs", `import { AsyncLocalStorage } from "node:async_hooks"; const s = new AsyncLocalStorage(); s.run(Bun, () => console.log(new (s.getStore().Glob)("*.js").match("a.js")));`, undefined, outOfSight],
  ["mjs", `import { EventEmitter } from "node:events"; const e = new EventEmitter(); e.on("x", b => console.log(new b.Glob("*.js").match("a.js"))); e.emit("x", Bun);`, undefined, outOfSight],
  ["mjs", `console.log(new (Object.assign(Object.create(null), Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `const key = process.argv.length > 100 ? "x" : "Glob"; console.log(new Bun[key]("*.js").match("a.js"));`],
  ["mjs", `const key = "Glob".split("").join(""); console.log(new Bun[key]("*.js").match("a.js"));`, undefined, "the list does not name Bun.Glob: --trim removes the class, and `new` throws ERR_FEATURE_REMOVED"],
  ["mjs", `console.log(Object.getOwnPropertyNames(Bun).filter(n => n === "Glob").map(n => new Bun[n]("*.js").match("a.js"))[0]);`, undefined, outOfSight],
  ["mjs", `class X extends Bun.Glob {} console.log(new X("*.js").match("a.js"));`, "as a class"],
  ["mjs", `console.log(new (Reflect.apply(Reflect.get, null, [Bun, "Glob"]))("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `function f({ Glob } = Bun) { return new Glob("*.js").match("a.js"); } console.log(f());`],
  ["mjs", `for await (const b of [Bun]) console.log(new b.Glob("*.js").match("a.js"));`],
  ["mjs", `async function* g() { yield Bun; } for await (const b of g()) console.log(new b.Glob("*.js").match("a.js"));`],
  ["mjs", `function* g() { yield Bun; } for (const b of g()) console.log(new b.Glob("*.js").match("a.js"));`],
  ["mjs", `const t = new EventTarget(); t.addEventListener("x", e => console.log(new e.detail.Glob("*.js").match("a.js"))); t.dispatchEvent(new CustomEvent("x", { detail: Bun }));`, undefined, outOfSight],
  ["mjs", `console.log(new (new CustomEvent("x", { detail: Bun }).detail.Glob)("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `console.log(new ((await Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ((await Promise.resolve(Bun)).Glob)("*.js").match("a.js"));`],
  ["mjs", `Promise.resolve(Bun).then(b => console.log(new b.Glob("*.js").match("a.js")));`],
  ["mjs", `new Promise(r => r(Bun)).then(b => console.log(new b.Glob("*.js").match("a.js")));`],
  ["mjs", `(async () => Bun)().then(b => console.log(new b.Glob("*.js").match("a.js")));`],
  ["mjs", `const [b] = await Promise.all([Bun]); console.log(new b.Glob("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `console.log(new ((await Promise.race([Bun])).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ((await Promise.any([Bun])).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ((await Promise.allSettled([Bun]))[0].value.Glob)("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `const { promise, resolve } = Promise.withResolvers(); resolve(Bun); promise.then(b => console.log(new b.Glob("*.js").match("a.js")));`, undefined, outOfSight],
  ["mjs", `Promise.reject(Bun).catch(b => console.log(new b.Glob("*.js").match("a.js")));`],
  ["mjs", `Promise.try(() => Bun).then(b => console.log(new b.Glob("*.js").match("a.js")));`, undefined, outOfSight],
  ["mjs", `try { throw Bun; } catch (b) { console.log(new b.Glob("*.js").match("a.js")); }`],
  ["mjs", `console.log(new (new Map([[1, Bun]]).get(1).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (new WeakMap([[Bun, Bun]]).get(Bun).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new (Bun[Reflect.ownKeys(Bun).find(k => k === "Glob")])("*.js").match("a.js"));`, undefined, outOfSight],
  ["mjs", `console.log(new (Object.values({ b: Bun })[0].Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ([Bun].find(Boolean).Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ([Bun].filter(Boolean)[0].Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ([[Bun]].flat()[0].Glob)("*.js").match("a.js"));`],
  ["mjs", `console.log(new ([Bun].reduce((a, b) => b, 0).Glob)("*.js").match("a.js"));`],
  ["mjs", `const { Glob, ...rest } = Bun; console.log(new Glob("*.js").match("a.js"), typeof rest);`],
  ["mjs", `console.log(new ({ ...Bun }.Glob)("*.js").match("a.js"));`],
];

const inPlaceOfBun = roadsToBunGlob.filter(([, , reachesModule]) => reachesModule !== "by the name of the module");
const called = /\bnew (?!Proxy|WeakRef|Map|WeakMap|Set|AsyncLocalStorage|EventEmitter|EventTarget|CustomEvent|Promise)/g;

const families: [name: string, keptFeature: string, roads: Road[]][] = [
  ["a class of Bun", "Bun.Glob", roadsToBunGlob],
  [
    "a class of the global object",
    "BroadcastChannel",
    inPlaceOfBun.map(([extension, text]) => [
      extension,
      text.replaceAll("Bun", "globalThis").replaceAll("Glob", "BroadcastChannel").replaceAll(`("*.js").match("a.js")`, `("x").close()`).replaceAll(`["*.js"]).match("a.js")`, `["x"]).close()`),
    ]),
  ],
  [
    "a function of process",
    "process.memoryUsage",
    inPlaceOfBun
      .filter(([, , reachesModule]) => reachesModule !== "as a class")
      .map(([extension, text]) => [extension, text.replaceAll("Bun", "process").replaceAll("Glob", "memoryUsage").replaceAll(`("*.js").match("a.js")`, `().rss > 0`).replace(called, "")]),
  ],
  [
    "a class of a node: module",
    "MessageChannel",
    inPlaceOfBun.map(([extension, text]) => [
      extension,
      (extension === "mjs" ? `import wt from "node:worker_threads"; ` : `const wt = require("node:worker_threads"); `) +
        text.replaceAll("Bun", "wt").replaceAll("Glob", "MessageChannel").replaceAll(`("*.js").match("a.js")`, `().port1.close()`).replaceAll(`["*.js"]).match("a.js")`, `[]).port1.close()`),
    ]),
  ],
];

/** `family`: 1 to 4. Each has a test file of its own: a road is a run of the compiler over Bun's library. */
export function roadsTo(family: number) {
  const [name, keptFeature, roads] = families[family - 1];
  describe.concurrent(`${name} is kept whatever the road to it`, () => {
    eachRow(roads.map(([extension, text, , notYet]) => (notYet ? gap(notYet, [text, extension] as const) : ([text, extension] as const))))("%s", async (text, extension) => {
      const entryPoint = `main.${extension}`;
      const use = await runtimeUse({ [entryPoint]: text + "\n" }, undefined, entryPoint);
      const kept = use.lines.filter(line => line.startsWith("kept ") && line.includes(keptFeature));
      expect({ exitCode: use.exitCode, isKept: kept.length > 0 }).toEqual({ exitCode: 0, isKept: true });
    });
  });
}
