import theDefault, { counter, bump, K, Box, neverCalledUntilLate, arrow, legacy, setLegacy } from "./shared";
import { counter as renamedCounter, Holder } from "./shared";
import * as ns from "./shared";
import { Renamed, bumpAgain, fromStar, starFn } from "./reexport";
import { aValue, tryReadA, hoisted } from "./cycleA";
import { early, tdz, bValue } from "./cycleB";
import { join, basename } from "node:path";
import { EventEmitter } from "node:events";
const out: string[] = [];
const say = (...a: unknown[]) => out.push(a.join(" "));
say("top", counter, K, theDefault(), legacy);
bump(); say("live", counter, renamedCounter, ns.counter);
function inner() { bump(); return () => { bumpAgain(); return counter + renamedCounter; }; }
say("closure", inner()());
say("class", new Box(5).get(), new ns.Box(6).get());
say("reexport", Renamed, fromStar, starFn());
say("cycle", aValue, bValue, early, tdz, tryReadA(), hoisted());
setLegacy("changed"); say("var", legacy, ns.legacy);
let sum = 0; for (let i = 0; i < 100000; i++) { sum += arrow(i) + K; if ((i & 16383) === 0) bump(); }
say("loop", sum, counter);
say("typeof", typeof K, typeof neverCalledUntilLate, typeof (globalThis as any).nope);
say("late", neverCalledUntilLate());
say("fields", new Holder().viaField, new Holder().lazy(), Holder.s);
say("builtin", join("a", "b"), basename("/x/y.z"), typeof EventEmitter, new EventEmitter().listenerCount("x"));
function globals() { return [typeof Object, typeof Math.max, Array.isArray([]), typeof process.pid, typeof undefinedGlobalName === "undefined"].join(","); }
declare const undefinedGlobalName: unknown;
say("globals", globals());
function missing() { try { // @ts-ignore
  return notDefinedAnywhere; } catch (e) { return (e as Error).constructor.name + ":" + (e as Error).message; } }
say("missing", missing());
(globalThis as any).lateGlobal = 1; declare const lateGlobal: number;
function readsLate() { return lateGlobal; }
say("lateGlobal", readsLate()); (globalThis as any).lateGlobal = 2; say("lateGlobal", readsLate());
const lazy = await import("./lazy");
say("lazy", lazy.fromLazy(), counter);
console.log(out.join("\n"));
