// ESM half of the corpus for bundler_bytecode_portable.test.ts: only parsed and generated (vm.SourceTextModule), never
// linked or run, so the imports need not resolve. Covers what only module code serializes: the module's variable
// environment with imported / exported / namespace-imported bindings, top-level await, import.meta, dynamic import,
// every declaration form at module top level, and strict-mode-only function shapes.
import defaultBinding from "./dep-a.js";
import * as namespace from "./dep-b.js";
import { named, other as renamed, "string name" as fromString } from "./dep-c.js";
import defaultAndNamed, { x as importedX } from "./dep-d.js";
import "./side-effect.js";
export const answer = await Promise.resolve(42);
export let mutable = 1;
export var hoisted = 2;
export function declared() { return mutable++; }
export function* generator() { yield hoisted; }
export async function asyncDeclared() { return await answer; }
export class Exported { static field = answer; #p = 1; get p() { return this.#p; } }
export { mutable as aliased, hoisted as "string export", declared as default2 };
export * from "./dep-e.js";
export * as reexportedNamespace from "./dep-f.js";
export { y, z as w, default as depDefault } from "./dep-g.js";
export default function describe() {
  return `answer=${answer} ${defaultBinding} ${namespace.thing} ${named} ${renamed} ${fromString} ${defaultAndNamed} ${importedX}`;
}
const notExported = () => import.meta.url.length + typeof import.meta.resolve;
let lazy;
if (answer > 40) lazy = await import("./dep-h.js").then(m => m.default, () => null);
for await (const chunk of (async function* () { yield 1; })()) mutable += chunk;
class Holder {
  static value = answer;
  static #instances = 0;
  #tag = "h";
  constructor() { Holder.#instances++; }
  toString() { return this.#tag + Holder.value + notExported(); }
  static get count() { return Holder.#instances; }
}
{
  let blockScoped = new Holder();
  function inBlock() { return blockScoped; } // strict: block-scoped, not hoisted
  lazy ??= inBlock();
}
label: for (const v of [1, 2]) { if (v === 2) break label; }
console.log("esm", describe(), String(new Holder()), Holder.count, typeof lazy, this === undefined);
