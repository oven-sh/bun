const say = (what: string, got: unknown) => console.log(what + ": " + (typeof got === "string" ? got : JSON.stringify(got) ?? String(got)));
const uncurryThis = <F extends (...a: any[]) => any>(f: F): ((self: unknown, ...a: any[]) => any) => Function.prototype.call.bind(f) as any;
const attempt = (f: () => unknown): unknown => { try { return f(); } catch (e) { return (e as Error).constructor.name; } };
const slice = uncurryThis(String.prototype.slice), isWellFormed = uncurryThis((String.prototype as any).isWellFormed), map = uncurryThis(Array.prototype.map), has = uncurryThis(Object.prototype.hasOwnProperty), push = uncurryThis(Array.prototype.push), toString = uncurryThis(Object.prototype.toString);
say("natives", [slice("abcdef", 1, 4), slice("abcdef"), isWellFormed("ok"), isWellFormed("\ud800"), map([1, 2, 3], (x: number) => x * 2), has({ a: 1 }, "a"), has({ a: 1 }, "b"), toString([]), toString(null), toString(undefined), toString()]);
{ const list: number[] = []; say("a native that writes", [push(list, 1, 2, 3), push(list), list]); }
function strict(this: unknown, ...rest: unknown[]) { return [typeof this, this === undefined ? "undefined" : this === null ? "null" : String(this), rest.length, rest]; }
const sloppy = new Function("return [typeof this, this === globalThis ? 'the global object' : String(this), arguments.length, Array.prototype.slice.call(arguments)]") as (...a: unknown[]) => unknown;
const two = function (this: { k: number }, a?: number, b?: number) { return [this.k, a, b, arguments.length]; };
const arrow = (...rest: unknown[]) => rest;
for (const [name, f] of [["strict", strict], ["sloppy", sloppy], ["an arrow function", arrow]] as const) {
  const u = uncurryThis(f as any);
  say(name, [u(), u(undefined), u(null), u(1), u("s", 1), u({ toString: () => "an object" }, 1, 2), u(true, 1, 2, 3, 4, 5, 6, 7), u(0, 1, 2, 3, 4, 5, 6, 7, 8), u(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)]);
}
{ const u = uncurryThis(two); say("fewer and more than it has parameters", [u({ k: 1 }), u({ k: 2 }, 1), u({ k: 3 }, 1, 2), u({ k: 4 }, 1, 2, 3)]); }
{ const withArgument = Function.prototype.call.bind(strict, "bound this") as any, withTwo = Function.prototype.call.bind(strict, "bound this", "bound argument") as any; say("with more bound", [withArgument(), withArgument(1, 2), withTwo(), withTwo(1)]); }
{ const nested = Function.prototype.call.bind(Function.prototype.call.bind(strict)) as any; say("one in another", [nested(), nested("ignored", "this", 1), nested(undefined, undefined)]); }
{ const u = uncurryThis(strict) as any; u.extra = 1; say("given a property", [u("t", 1), u.extra, u.name, u.length]); }
{ const applied = Function.prototype.apply.bind(strict) as any; say("apply, not call", [applied("t", [1, 2]), applied("t"), applied()]); }
{ const plain = strict.bind("plainly bound") as any; say("bound, but not call", [plain(), plain(1, 2)]); }
for (const bad of [5, undefined, null, {}, "s"]) say("of what cannot be called: " + String(bad), attempt(() => (Function.prototype.call.bind(bad as any) as any)(1, 2)));
say("constructed", attempt(() => new (uncurryThis(strict) as any)(1)));
{ const thrower = uncurryThis(function (this: unknown, what: string) { throw new RangeError(what + " " + String(this)); }); let message = ""; try { thrower("t", "thrown"); } catch (e) { message = (e as Error).message + " " + (e as Error).constructor.name; } say("throws", message); }
{ class K { #x = 7; get() { return this.#x; } } const get = uncurryThis(K.prototype.get); say("a method with a private name", [get(new K()), attempt(() => get({}))]); }
{ const gen = uncurryThis(function* (this: unknown, a: number) { yield this; yield a; }); say("a generator", [...gen("t", 1)]); }
{ const later = uncurryThis(async function (this: unknown, a: number) { return [this, a]; }); later("t", 1).then((v: unknown) => say("an async function", v)); }
{ const self = uncurryThis(function f(this: number, n: number): number { return n ? (self(this + 1, n - 1) as number) : this; }) as any; say("calls itself through it", self(0, 50)); }
{ const many = [uncurryThis(strict), uncurryThis(String.prototype.trim), strict.bind("b") as any, uncurryThis(two), (x: unknown) => x]; let s = ""; for (let round = 0; round < 3; round++) for (const f of many) s += JSON.stringify(attempt(() => f({ k: 1, toString: () => " o " }, round))) + ";"; say("a mixture", s); }
{ let n = 0; for (let i = 0; i < 20000; i++) if (isWellFormed("string " + i)) n++; say("many times", n); }
export {};
