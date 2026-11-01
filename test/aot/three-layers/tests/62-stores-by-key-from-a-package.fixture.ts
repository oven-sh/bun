import { check } from "../src/show";
import { assignAll, makeTheirs, mergeWith, set, Theirs } from "fake-merge";
import { makers, sources, Settings, type Maker } from "../src/settings";
const F = "62";
class Mine { a?: number; b?: string; c: { x?: number; y?: string } = {}; late?: unknown; n = 62; constructor(i = 0) { if (i & 1) this.a = i; if (i & 2) this.b = "b"; } }
const mine: Record<string, Maker> = { myEmpty: () => ({}), myLiteral: i => (i & 1 ? { a: 1, b: "s", c: { x: 1 } } : { a: 1, c: {} }), mine: i => new Mine(i), mySubclass: i => new (class extends Settings { own = i })(i), theirs: makeTheirs, theirClass: i => new Theirs(i) };
const customizer = (present: unknown, value: unknown) => (Array.isArray(present) && Array.isArray(value) ? present.concat(value) : undefined);
const targets = Object.entries({ ...makers, ...mine }), from = Object.entries({ ...sources, ...mine });
const attempt = (body: () => unknown) => { try { return body(); } catch (error: any) { return "threw " + error.constructor.name; } };
// One site of the package sees objects of the three images in turn, with the field there, not there yet, of another type, out of line, or no field at all.
const everything = (merge: (target: any, source: any) => unknown) => [0, 1, 2, 3].map(i => targets.map(([, target]) => from.map(([, source]) => attempt(() => merge(target(i), source(i + 1))))));
check(F, "merged with a customizer", () => everything((target, source) => mergeWith(target, source, customizer)));
check(F, "merged into a fresh object", () => everything((target, source) => mergeWith({}, target, source, customizer)));
check(F, "assigned key by key", () => everything(assignAll));
check(F, "behind a collection", () => { Bun.gc(true); return everything((target, source) => mergeWith(target, source)); });
check(F, "frozen, sealed, not extensible", () => targets.map(([, target]) => [Object.freeze(target(3)), Object.seal(target(3)), Object.preventExtensions(target(3))].map(object => attempt(() => set(set(object, "a", 9), "fresh", 1)))));
check(F, "nothing reached Object.prototype", () => ({} as any).polluted);
