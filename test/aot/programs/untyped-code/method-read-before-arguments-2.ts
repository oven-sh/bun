// `x.m(argument)`: the method is read before the arguments are evaluated, whatever the receiver is and whatever the arguments do to it.
class Oops extends Error { }
const notes: string[] = [];
const other = new Set(["a", "b", "z"]);
function identity(v: any): any { return v; }
function note(text: string, v: any): any { notes.push(text); return v; }
function holder(v: any): any { return { get value() { notes.push("getter of the argument"); return v; } }; }
function fail(v: any): any { notes.push("throws"); throw new Oops("thrown by the argument"); }
function isObject(x: any): boolean { return typeof x === "object" && x !== null; }
function wrapper(said: string, m: string, home: any): any { return function (this: any, ...all: any[]) { notes.push(said + " " + m); return home[m].apply(this, all); }; }
function homeOf(x: any): any { return x instanceof Array ? Array.prototype : x instanceof Map ? Map.prototype : x instanceof Set ? Set.prototype : x instanceof RegExp ? RegExp.prototype : x instanceof Promise ? Promise.prototype : String.prototype; }
function alterOwn(x: any, m: string, v: any): any { notes.push("alters"); if (isObject(x) && Object.isExtensible(x)) Object.defineProperty(x, m, { value: wrapper("its own", m, homeOf(x)), configurable: true, writable: true }); return v; }
function alterPrototype(x: any, m: string, v: any): any { notes.push("alters"); if (isObject(x) && Object.isExtensible(x)) { const p = Object.create(Object.getPrototypeOf(x)); p[m] = wrapper("inherited", m, homeOf(x)); Object.setPrototypeOf(x, p); } return v; }
function addAndDelete(x: any, v: any): any { notes.push("adds and deletes"); if (isObject(x) && Object.isExtensible(x)) { x.extra = 1; delete x.extra; } return v; }
function show(v: any): string {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "function") return "function";
    if (typeof v !== "object") return String(v);
    if (Array.isArray(v)) return "[" + Array.prototype.map.call(v, show).join(",") + "]";
    if (v instanceof Map) return "Map(" + Array.from(Map.prototype.entries.call(v)).map(show).join(",") + ")";
    if (v instanceof Set) return "Set(" + Array.from(Set.prototype.values.call(v)).map(show).join(",") + ")";
    return Object.prototype.toString.call(v);
}
function thrown(e: any): string { return "caught " + (e instanceof Error ? e.constructor.name : show(e)); }
const made: Record<string, () => any> = {
    Array: () => [1, 2, 3], String: () => "abcabc", Map: () => new Map([["a", 1], ["b", 2]]), Set: () => new Set(["a", "b"]), RegExp: () => /b/, Promise: () => Promise.resolve(1),
};
class ArrayHeir extends Array<number> { }
class MapHeir extends Map<string, number> { }
class SetHeir extends Set<string> { }
const heirs: Record<string, () => any> = { Array: () => ArrayHeir.from([1, 2, 3]), Map: () => new MapHeir([["a", 1]]), Set: () => new SetHeir(["a"]) };
function receiversOf(c: string, m: string, typed: boolean): Array<[string, () => any]> {
    const all: Array<[string, () => any]> = [["as made", made[c]]];
    if (c !== "String") {
        all.push(["with its own", () => { const x = made[c](); x[m] = wrapper("its own", m, homeOf(x)); return x; }]);
        all.push(["with a getter", () => { const x = made[c](); const f = wrapper("got", m, homeOf(x)); Object.defineProperty(x, m, { get() { notes.push("getter of " + m); return f; }, configurable: true }); return x; }]);
        all.push(["with another prototype", () => { const x = made[c](); const p = Object.create(Object.getPrototypeOf(x)); p[m] = wrapper("inherited", m, homeOf(x)); Object.setPrototypeOf(x, p); return x; }]);
        all.push(["frozen", () => Object.freeze(made[c]())]);
        if (heirs[c]) {
            all.push(["a subclass", heirs[c]]);
            all.push(["a subclass with its own", () => { const x = heirs[c](); x[m] = wrapper("its own", m, homeOf(x)); return x; }]);
        }
    }
    if (typed) return all;
    if (c === "Array") all.push(["a proxy", () => new Proxy(made[c](), { get(t: any, key: any, r: any) { if (typeof key === "string") notes.push("trap " + key); return Reflect.get(t, key, r); } })]);
    all.push(["another object", () => ({ [m](...given: any[]) { notes.push("another's " + m); return "of " + given.length; } })]);
    all.push(["another object with a getter", () => ({ get [m]() { notes.push("getter of " + m); return () => "from a getter"; } })]);
    all.push(["no function", () => ({ [m]: 1 })]);
    all.push(["nothing of the name", () => ({ })]);
    all.push(["undefined", () => undefined], ["null", () => null], ["a number", () => 5], ["a string", () => "xbx"], ["an array", () => [2, 1]]);
    return all;
}
const table: Array<[string, string, string, boolean, (x: any, k: any) => any]> = [];

function uArray_slice_call_plain(x: any, k: any): any { const r = x.slice(note("argument", 1)); return [r]; }
table.push(["uArray_slice_call_plain", "Array", "slice", false, uArray_slice_call_plain]);
function uArray_slice_call_tail(x: any, k: any): any { return x.slice(note("argument", 1)); }
table.push(["uArray_slice_call_tail", "Array", "slice", false, uArray_slice_call_tail]);
function uArray_slice_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(note("argument", 1)); return [r]; }
table.push(["uArray_slice_call_loop", "Array", "slice", false, uArray_slice_call_loop]);
function uArray_slice_call_watched(x: any, k: any): any { try { const r = x.slice(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_slice_call_watched", "Array", "slice", false, uArray_slice_call_watched]);
function uArray_slice_getter_plain(x: any, k: any): any { const r = x.slice(holder(1).value); return [r]; }
table.push(["uArray_slice_getter_plain", "Array", "slice", false, uArray_slice_getter_plain]);
function uArray_slice_getter_tail(x: any, k: any): any { return x.slice(holder(1).value); }
table.push(["uArray_slice_getter_tail", "Array", "slice", false, uArray_slice_getter_tail]);
function uArray_slice_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(holder(1).value); return [r]; }
table.push(["uArray_slice_getter_loop", "Array", "slice", false, uArray_slice_getter_loop]);
function uArray_slice_getter_watched(x: any, k: any): any { try { const r = x.slice(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_slice_getter_watched", "Array", "slice", false, uArray_slice_getter_watched]);
function uArray_slice_own_plain(x: any, k: any): any { const r = x.slice(alterOwn(x, "slice", 1)); return [r]; }
table.push(["uArray_slice_own_plain", "Array", "slice", false, uArray_slice_own_plain]);
function uArray_slice_own_tail(x: any, k: any): any { return x.slice(alterOwn(x, "slice", 1)); }
table.push(["uArray_slice_own_tail", "Array", "slice", false, uArray_slice_own_tail]);
function uArray_slice_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(alterOwn(x, "slice", 1)); return [r]; }
table.push(["uArray_slice_own_loop", "Array", "slice", false, uArray_slice_own_loop]);
function uArray_slice_own_watched(x: any, k: any): any { try { const r = x.slice(alterOwn(x, "slice", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_slice_own_watched", "Array", "slice", false, uArray_slice_own_watched]);
function uArray_slice_prototype_plain(x: any, k: any): any { const r = x.slice(alterPrototype(x, "slice", 1)); return [r]; }
table.push(["uArray_slice_prototype_plain", "Array", "slice", false, uArray_slice_prototype_plain]);
function uArray_slice_prototype_tail(x: any, k: any): any { return x.slice(alterPrototype(x, "slice", 1)); }
table.push(["uArray_slice_prototype_tail", "Array", "slice", false, uArray_slice_prototype_tail]);
function uArray_slice_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(alterPrototype(x, "slice", 1)); return [r]; }
table.push(["uArray_slice_prototype_loop", "Array", "slice", false, uArray_slice_prototype_loop]);
function uArray_slice_prototype_watched(x: any, k: any): any { try { const r = x.slice(alterPrototype(x, "slice", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_slice_prototype_watched", "Array", "slice", false, uArray_slice_prototype_watched]);
function uArray_slice_round_plain(x: any, k: any): any { const r = x.slice(addAndDelete(x, 1)); return [r]; }
table.push(["uArray_slice_round_plain", "Array", "slice", false, uArray_slice_round_plain]);
function uArray_slice_round_tail(x: any, k: any): any { return x.slice(addAndDelete(x, 1)); }
table.push(["uArray_slice_round_tail", "Array", "slice", false, uArray_slice_round_tail]);
function uArray_slice_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(addAndDelete(x, 1)); return [r]; }
table.push(["uArray_slice_round_loop", "Array", "slice", false, uArray_slice_round_loop]);
function uArray_slice_round_watched(x: any, k: any): any { try { const r = x.slice(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_slice_round_watched", "Array", "slice", false, uArray_slice_round_watched]);
function uArray_slice_conditional_plain(x: any, k: any): any { const r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uArray_slice_conditional_plain", "Array", "slice", false, uArray_slice_conditional_plain]);
function uArray_slice_conditional_tail(x: any, k: any): any { return x.slice((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uArray_slice_conditional_tail", "Array", "slice", false, uArray_slice_conditional_tail]);
function uArray_slice_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uArray_slice_conditional_loop", "Array", "slice", false, uArray_slice_conditional_loop]);
function uArray_slice_conditional_watched(x: any, k: any): any { try { const r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_slice_conditional_watched", "Array", "slice", false, uArray_slice_conditional_watched]);
function uArray_slice_throws_plain(x: any, k: any): any { const r = x.slice(fail(1)); return [r]; }
table.push(["uArray_slice_throws_plain", "Array", "slice", false, uArray_slice_throws_plain]);
function uArray_slice_throws_tail(x: any, k: any): any { return x.slice(fail(1)); }
table.push(["uArray_slice_throws_tail", "Array", "slice", false, uArray_slice_throws_tail]);
function uArray_slice_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(fail(1)); return [r]; }
table.push(["uArray_slice_throws_loop", "Array", "slice", false, uArray_slice_throws_loop]);
function uArray_slice_throws_watched(x: any, k: any): any { try { const r = x.slice(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_slice_throws_watched", "Array", "slice", false, uArray_slice_throws_watched]);
function uArray_indexOf_call_plain(x: any, k: any): any { const r = x.indexOf(note("argument", 2)); return [r]; }
table.push(["uArray_indexOf_call_plain", "Array", "indexOf", false, uArray_indexOf_call_plain]);
function uArray_indexOf_call_tail(x: any, k: any): any { return x.indexOf(note("argument", 2)); }
table.push(["uArray_indexOf_call_tail", "Array", "indexOf", false, uArray_indexOf_call_tail]);
function uArray_indexOf_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(note("argument", 2)); return [r]; }
table.push(["uArray_indexOf_call_loop", "Array", "indexOf", false, uArray_indexOf_call_loop]);
function uArray_indexOf_call_watched(x: any, k: any): any { try { const r = x.indexOf(note("argument", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_indexOf_call_watched", "Array", "indexOf", false, uArray_indexOf_call_watched]);
function uArray_indexOf_getter_plain(x: any, k: any): any { const r = x.indexOf(holder(2).value); return [r]; }
table.push(["uArray_indexOf_getter_plain", "Array", "indexOf", false, uArray_indexOf_getter_plain]);
function uArray_indexOf_getter_tail(x: any, k: any): any { return x.indexOf(holder(2).value); }
table.push(["uArray_indexOf_getter_tail", "Array", "indexOf", false, uArray_indexOf_getter_tail]);
function uArray_indexOf_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(holder(2).value); return [r]; }
table.push(["uArray_indexOf_getter_loop", "Array", "indexOf", false, uArray_indexOf_getter_loop]);
function uArray_indexOf_getter_watched(x: any, k: any): any { try { const r = x.indexOf(holder(2).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_indexOf_getter_watched", "Array", "indexOf", false, uArray_indexOf_getter_watched]);
function uArray_indexOf_own_plain(x: any, k: any): any { const r = x.indexOf(alterOwn(x, "indexOf", 2)); return [r]; }
table.push(["uArray_indexOf_own_plain", "Array", "indexOf", false, uArray_indexOf_own_plain]);
function uArray_indexOf_own_tail(x: any, k: any): any { return x.indexOf(alterOwn(x, "indexOf", 2)); }
table.push(["uArray_indexOf_own_tail", "Array", "indexOf", false, uArray_indexOf_own_tail]);
function uArray_indexOf_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(alterOwn(x, "indexOf", 2)); return [r]; }
table.push(["uArray_indexOf_own_loop", "Array", "indexOf", false, uArray_indexOf_own_loop]);
function uArray_indexOf_own_watched(x: any, k: any): any { try { const r = x.indexOf(alterOwn(x, "indexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_indexOf_own_watched", "Array", "indexOf", false, uArray_indexOf_own_watched]);
function uArray_indexOf_prototype_plain(x: any, k: any): any { const r = x.indexOf(alterPrototype(x, "indexOf", 2)); return [r]; }
table.push(["uArray_indexOf_prototype_plain", "Array", "indexOf", false, uArray_indexOf_prototype_plain]);
function uArray_indexOf_prototype_tail(x: any, k: any): any { return x.indexOf(alterPrototype(x, "indexOf", 2)); }
table.push(["uArray_indexOf_prototype_tail", "Array", "indexOf", false, uArray_indexOf_prototype_tail]);
function uArray_indexOf_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(alterPrototype(x, "indexOf", 2)); return [r]; }
table.push(["uArray_indexOf_prototype_loop", "Array", "indexOf", false, uArray_indexOf_prototype_loop]);
function uArray_indexOf_prototype_watched(x: any, k: any): any { try { const r = x.indexOf(alterPrototype(x, "indexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_indexOf_prototype_watched", "Array", "indexOf", false, uArray_indexOf_prototype_watched]);
function uArray_indexOf_round_plain(x: any, k: any): any { const r = x.indexOf(addAndDelete(x, 2)); return [r]; }
table.push(["uArray_indexOf_round_plain", "Array", "indexOf", false, uArray_indexOf_round_plain]);
function uArray_indexOf_round_tail(x: any, k: any): any { return x.indexOf(addAndDelete(x, 2)); }
table.push(["uArray_indexOf_round_tail", "Array", "indexOf", false, uArray_indexOf_round_tail]);
function uArray_indexOf_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(addAndDelete(x, 2)); return [r]; }
table.push(["uArray_indexOf_round_loop", "Array", "indexOf", false, uArray_indexOf_round_loop]);
function uArray_indexOf_round_watched(x: any, k: any): any { try { const r = x.indexOf(addAndDelete(x, 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_indexOf_round_watched", "Array", "indexOf", false, uArray_indexOf_round_watched]);
function uArray_indexOf_conditional_plain(x: any, k: any): any { const r = x.indexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uArray_indexOf_conditional_plain", "Array", "indexOf", false, uArray_indexOf_conditional_plain]);
function uArray_indexOf_conditional_tail(x: any, k: any): any { return x.indexOf((k ? note("yes", 2) : note("no", undefined))); }
table.push(["uArray_indexOf_conditional_tail", "Array", "indexOf", false, uArray_indexOf_conditional_tail]);
function uArray_indexOf_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uArray_indexOf_conditional_loop", "Array", "indexOf", false, uArray_indexOf_conditional_loop]);
function uArray_indexOf_conditional_watched(x: any, k: any): any { try { const r = x.indexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_indexOf_conditional_watched", "Array", "indexOf", false, uArray_indexOf_conditional_watched]);
function uArray_indexOf_throws_plain(x: any, k: any): any { const r = x.indexOf(fail(2)); return [r]; }
table.push(["uArray_indexOf_throws_plain", "Array", "indexOf", false, uArray_indexOf_throws_plain]);
function uArray_indexOf_throws_tail(x: any, k: any): any { return x.indexOf(fail(2)); }
table.push(["uArray_indexOf_throws_tail", "Array", "indexOf", false, uArray_indexOf_throws_tail]);
function uArray_indexOf_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(fail(2)); return [r]; }
table.push(["uArray_indexOf_throws_loop", "Array", "indexOf", false, uArray_indexOf_throws_loop]);
function uArray_indexOf_throws_watched(x: any, k: any): any { try { const r = x.indexOf(fail(2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_indexOf_throws_watched", "Array", "indexOf", false, uArray_indexOf_throws_watched]);
function uArray_includes_call_plain(x: any, k: any): any { const r = x.includes(note("argument", 2)); return [r]; }
table.push(["uArray_includes_call_plain", "Array", "includes", false, uArray_includes_call_plain]);
function uArray_includes_call_tail(x: any, k: any): any { return x.includes(note("argument", 2)); }
table.push(["uArray_includes_call_tail", "Array", "includes", false, uArray_includes_call_tail]);
function uArray_includes_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(note("argument", 2)); return [r]; }
table.push(["uArray_includes_call_loop", "Array", "includes", false, uArray_includes_call_loop]);
function uArray_includes_call_watched(x: any, k: any): any { try { const r = x.includes(note("argument", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_includes_call_watched", "Array", "includes", false, uArray_includes_call_watched]);
function uArray_includes_getter_plain(x: any, k: any): any { const r = x.includes(holder(2).value); return [r]; }
table.push(["uArray_includes_getter_plain", "Array", "includes", false, uArray_includes_getter_plain]);
function uArray_includes_getter_tail(x: any, k: any): any { return x.includes(holder(2).value); }
table.push(["uArray_includes_getter_tail", "Array", "includes", false, uArray_includes_getter_tail]);
function uArray_includes_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(holder(2).value); return [r]; }
table.push(["uArray_includes_getter_loop", "Array", "includes", false, uArray_includes_getter_loop]);
function uArray_includes_getter_watched(x: any, k: any): any { try { const r = x.includes(holder(2).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_includes_getter_watched", "Array", "includes", false, uArray_includes_getter_watched]);
function uArray_includes_own_plain(x: any, k: any): any { const r = x.includes(alterOwn(x, "includes", 2)); return [r]; }
table.push(["uArray_includes_own_plain", "Array", "includes", false, uArray_includes_own_plain]);
function uArray_includes_own_tail(x: any, k: any): any { return x.includes(alterOwn(x, "includes", 2)); }
table.push(["uArray_includes_own_tail", "Array", "includes", false, uArray_includes_own_tail]);
function uArray_includes_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(alterOwn(x, "includes", 2)); return [r]; }
table.push(["uArray_includes_own_loop", "Array", "includes", false, uArray_includes_own_loop]);
function uArray_includes_own_watched(x: any, k: any): any { try { const r = x.includes(alterOwn(x, "includes", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_includes_own_watched", "Array", "includes", false, uArray_includes_own_watched]);
function uArray_includes_prototype_plain(x: any, k: any): any { const r = x.includes(alterPrototype(x, "includes", 2)); return [r]; }
table.push(["uArray_includes_prototype_plain", "Array", "includes", false, uArray_includes_prototype_plain]);
function uArray_includes_prototype_tail(x: any, k: any): any { return x.includes(alterPrototype(x, "includes", 2)); }
table.push(["uArray_includes_prototype_tail", "Array", "includes", false, uArray_includes_prototype_tail]);
function uArray_includes_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(alterPrototype(x, "includes", 2)); return [r]; }
table.push(["uArray_includes_prototype_loop", "Array", "includes", false, uArray_includes_prototype_loop]);
function uArray_includes_prototype_watched(x: any, k: any): any { try { const r = x.includes(alterPrototype(x, "includes", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_includes_prototype_watched", "Array", "includes", false, uArray_includes_prototype_watched]);
function uArray_includes_round_plain(x: any, k: any): any { const r = x.includes(addAndDelete(x, 2)); return [r]; }
table.push(["uArray_includes_round_plain", "Array", "includes", false, uArray_includes_round_plain]);
function uArray_includes_round_tail(x: any, k: any): any { return x.includes(addAndDelete(x, 2)); }
table.push(["uArray_includes_round_tail", "Array", "includes", false, uArray_includes_round_tail]);
function uArray_includes_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(addAndDelete(x, 2)); return [r]; }
table.push(["uArray_includes_round_loop", "Array", "includes", false, uArray_includes_round_loop]);
function uArray_includes_round_watched(x: any, k: any): any { try { const r = x.includes(addAndDelete(x, 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_includes_round_watched", "Array", "includes", false, uArray_includes_round_watched]);
function uArray_includes_conditional_plain(x: any, k: any): any { const r = x.includes((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uArray_includes_conditional_plain", "Array", "includes", false, uArray_includes_conditional_plain]);
function uArray_includes_conditional_tail(x: any, k: any): any { return x.includes((k ? note("yes", 2) : note("no", undefined))); }
table.push(["uArray_includes_conditional_tail", "Array", "includes", false, uArray_includes_conditional_tail]);
function uArray_includes_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uArray_includes_conditional_loop", "Array", "includes", false, uArray_includes_conditional_loop]);
function uArray_includes_conditional_watched(x: any, k: any): any { try { const r = x.includes((k ? note("yes", 2) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_includes_conditional_watched", "Array", "includes", false, uArray_includes_conditional_watched]);
function uArray_includes_throws_plain(x: any, k: any): any { const r = x.includes(fail(2)); return [r]; }
table.push(["uArray_includes_throws_plain", "Array", "includes", false, uArray_includes_throws_plain]);
function uArray_includes_throws_tail(x: any, k: any): any { return x.includes(fail(2)); }
table.push(["uArray_includes_throws_tail", "Array", "includes", false, uArray_includes_throws_tail]);
function uArray_includes_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(fail(2)); return [r]; }
table.push(["uArray_includes_throws_loop", "Array", "includes", false, uArray_includes_throws_loop]);
function uArray_includes_throws_watched(x: any, k: any): any { try { const r = x.includes(fail(2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_includes_throws_watched", "Array", "includes", false, uArray_includes_throws_watched]);
function uArray_join_call_plain(x: any, k: any): any { const r = x.join(note("argument", "-")); return [r]; }
table.push(["uArray_join_call_plain", "Array", "join", false, uArray_join_call_plain]);
function uArray_join_call_tail(x: any, k: any): any { return x.join(note("argument", "-")); }
table.push(["uArray_join_call_tail", "Array", "join", false, uArray_join_call_tail]);
function uArray_join_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(note("argument", "-")); return [r]; }
table.push(["uArray_join_call_loop", "Array", "join", false, uArray_join_call_loop]);
function uArray_join_call_watched(x: any, k: any): any { try { const r = x.join(note("argument", "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_join_call_watched", "Array", "join", false, uArray_join_call_watched]);
function uArray_join_getter_plain(x: any, k: any): any { const r = x.join(holder("-").value); return [r]; }
table.push(["uArray_join_getter_plain", "Array", "join", false, uArray_join_getter_plain]);
function uArray_join_getter_tail(x: any, k: any): any { return x.join(holder("-").value); }
table.push(["uArray_join_getter_tail", "Array", "join", false, uArray_join_getter_tail]);
function uArray_join_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(holder("-").value); return [r]; }
table.push(["uArray_join_getter_loop", "Array", "join", false, uArray_join_getter_loop]);
function uArray_join_getter_watched(x: any, k: any): any { try { const r = x.join(holder("-").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_join_getter_watched", "Array", "join", false, uArray_join_getter_watched]);
function uArray_join_own_plain(x: any, k: any): any { const r = x.join(alterOwn(x, "join", "-")); return [r]; }
table.push(["uArray_join_own_plain", "Array", "join", false, uArray_join_own_plain]);
function uArray_join_own_tail(x: any, k: any): any { return x.join(alterOwn(x, "join", "-")); }
table.push(["uArray_join_own_tail", "Array", "join", false, uArray_join_own_tail]);
function uArray_join_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(alterOwn(x, "join", "-")); return [r]; }
table.push(["uArray_join_own_loop", "Array", "join", false, uArray_join_own_loop]);
function uArray_join_own_watched(x: any, k: any): any { try { const r = x.join(alterOwn(x, "join", "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_join_own_watched", "Array", "join", false, uArray_join_own_watched]);
function uArray_join_prototype_plain(x: any, k: any): any { const r = x.join(alterPrototype(x, "join", "-")); return [r]; }
table.push(["uArray_join_prototype_plain", "Array", "join", false, uArray_join_prototype_plain]);
function uArray_join_prototype_tail(x: any, k: any): any { return x.join(alterPrototype(x, "join", "-")); }
table.push(["uArray_join_prototype_tail", "Array", "join", false, uArray_join_prototype_tail]);
function uArray_join_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(alterPrototype(x, "join", "-")); return [r]; }
table.push(["uArray_join_prototype_loop", "Array", "join", false, uArray_join_prototype_loop]);
function uArray_join_prototype_watched(x: any, k: any): any { try { const r = x.join(alterPrototype(x, "join", "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_join_prototype_watched", "Array", "join", false, uArray_join_prototype_watched]);
function uArray_join_round_plain(x: any, k: any): any { const r = x.join(addAndDelete(x, "-")); return [r]; }
table.push(["uArray_join_round_plain", "Array", "join", false, uArray_join_round_plain]);
function uArray_join_round_tail(x: any, k: any): any { return x.join(addAndDelete(x, "-")); }
table.push(["uArray_join_round_tail", "Array", "join", false, uArray_join_round_tail]);
function uArray_join_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(addAndDelete(x, "-")); return [r]; }
table.push(["uArray_join_round_loop", "Array", "join", false, uArray_join_round_loop]);
function uArray_join_round_watched(x: any, k: any): any { try { const r = x.join(addAndDelete(x, "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_join_round_watched", "Array", "join", false, uArray_join_round_watched]);
function uArray_join_conditional_plain(x: any, k: any): any { const r = x.join((k ? note("yes", "-") : note("no", undefined))); return [r]; }
table.push(["uArray_join_conditional_plain", "Array", "join", false, uArray_join_conditional_plain]);
function uArray_join_conditional_tail(x: any, k: any): any { return x.join((k ? note("yes", "-") : note("no", undefined))); }
table.push(["uArray_join_conditional_tail", "Array", "join", false, uArray_join_conditional_tail]);
function uArray_join_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join((k ? note("yes", "-") : note("no", undefined))); return [r]; }
table.push(["uArray_join_conditional_loop", "Array", "join", false, uArray_join_conditional_loop]);
function uArray_join_conditional_watched(x: any, k: any): any { try { const r = x.join((k ? note("yes", "-") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_join_conditional_watched", "Array", "join", false, uArray_join_conditional_watched]);
function uArray_join_throws_plain(x: any, k: any): any { const r = x.join(fail("-")); return [r]; }
table.push(["uArray_join_throws_plain", "Array", "join", false, uArray_join_throws_plain]);
function uArray_join_throws_tail(x: any, k: any): any { return x.join(fail("-")); }
table.push(["uArray_join_throws_tail", "Array", "join", false, uArray_join_throws_tail]);
function uArray_join_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(fail("-")); return [r]; }
table.push(["uArray_join_throws_loop", "Array", "join", false, uArray_join_throws_loop]);
function uArray_join_throws_watched(x: any, k: any): any { try { const r = x.join(fail("-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_join_throws_watched", "Array", "join", false, uArray_join_throws_watched]);
function uArray_concat_call_plain(x: any, k: any): any { const r = x.concat(note("argument", 9)); return [r]; }
table.push(["uArray_concat_call_plain", "Array", "concat", false, uArray_concat_call_plain]);
function uArray_concat_call_tail(x: any, k: any): any { return x.concat(note("argument", 9)); }
table.push(["uArray_concat_call_tail", "Array", "concat", false, uArray_concat_call_tail]);
function uArray_concat_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(note("argument", 9)); return [r]; }
table.push(["uArray_concat_call_loop", "Array", "concat", false, uArray_concat_call_loop]);
function uArray_concat_call_watched(x: any, k: any): any { try { const r = x.concat(note("argument", 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_concat_call_watched", "Array", "concat", false, uArray_concat_call_watched]);
function uArray_concat_getter_plain(x: any, k: any): any { const r = x.concat(holder(9).value); return [r]; }
table.push(["uArray_concat_getter_plain", "Array", "concat", false, uArray_concat_getter_plain]);
function uArray_concat_getter_tail(x: any, k: any): any { return x.concat(holder(9).value); }
table.push(["uArray_concat_getter_tail", "Array", "concat", false, uArray_concat_getter_tail]);
function uArray_concat_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(holder(9).value); return [r]; }
table.push(["uArray_concat_getter_loop", "Array", "concat", false, uArray_concat_getter_loop]);
function uArray_concat_getter_watched(x: any, k: any): any { try { const r = x.concat(holder(9).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_concat_getter_watched", "Array", "concat", false, uArray_concat_getter_watched]);
function uArray_concat_own_plain(x: any, k: any): any { const r = x.concat(alterOwn(x, "concat", 9)); return [r]; }
table.push(["uArray_concat_own_plain", "Array", "concat", false, uArray_concat_own_plain]);
function uArray_concat_own_tail(x: any, k: any): any { return x.concat(alterOwn(x, "concat", 9)); }
table.push(["uArray_concat_own_tail", "Array", "concat", false, uArray_concat_own_tail]);
function uArray_concat_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(alterOwn(x, "concat", 9)); return [r]; }
table.push(["uArray_concat_own_loop", "Array", "concat", false, uArray_concat_own_loop]);
function uArray_concat_own_watched(x: any, k: any): any { try { const r = x.concat(alterOwn(x, "concat", 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_concat_own_watched", "Array", "concat", false, uArray_concat_own_watched]);
function uArray_concat_prototype_plain(x: any, k: any): any { const r = x.concat(alterPrototype(x, "concat", 9)); return [r]; }
table.push(["uArray_concat_prototype_plain", "Array", "concat", false, uArray_concat_prototype_plain]);
function uArray_concat_prototype_tail(x: any, k: any): any { return x.concat(alterPrototype(x, "concat", 9)); }
table.push(["uArray_concat_prototype_tail", "Array", "concat", false, uArray_concat_prototype_tail]);
function uArray_concat_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(alterPrototype(x, "concat", 9)); return [r]; }
table.push(["uArray_concat_prototype_loop", "Array", "concat", false, uArray_concat_prototype_loop]);
function uArray_concat_prototype_watched(x: any, k: any): any { try { const r = x.concat(alterPrototype(x, "concat", 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_concat_prototype_watched", "Array", "concat", false, uArray_concat_prototype_watched]);
function uArray_concat_round_plain(x: any, k: any): any { const r = x.concat(addAndDelete(x, 9)); return [r]; }
table.push(["uArray_concat_round_plain", "Array", "concat", false, uArray_concat_round_plain]);
function uArray_concat_round_tail(x: any, k: any): any { return x.concat(addAndDelete(x, 9)); }
table.push(["uArray_concat_round_tail", "Array", "concat", false, uArray_concat_round_tail]);
function uArray_concat_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(addAndDelete(x, 9)); return [r]; }
table.push(["uArray_concat_round_loop", "Array", "concat", false, uArray_concat_round_loop]);
function uArray_concat_round_watched(x: any, k: any): any { try { const r = x.concat(addAndDelete(x, 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_concat_round_watched", "Array", "concat", false, uArray_concat_round_watched]);
function uArray_concat_conditional_plain(x: any, k: any): any { const r = x.concat((k ? note("yes", 9) : note("no", undefined))); return [r]; }
table.push(["uArray_concat_conditional_plain", "Array", "concat", false, uArray_concat_conditional_plain]);
function uArray_concat_conditional_tail(x: any, k: any): any { return x.concat((k ? note("yes", 9) : note("no", undefined))); }
table.push(["uArray_concat_conditional_tail", "Array", "concat", false, uArray_concat_conditional_tail]);
function uArray_concat_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat((k ? note("yes", 9) : note("no", undefined))); return [r]; }
table.push(["uArray_concat_conditional_loop", "Array", "concat", false, uArray_concat_conditional_loop]);
function uArray_concat_conditional_watched(x: any, k: any): any { try { const r = x.concat((k ? note("yes", 9) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_concat_conditional_watched", "Array", "concat", false, uArray_concat_conditional_watched]);
function uArray_concat_throws_plain(x: any, k: any): any { const r = x.concat(fail(9)); return [r]; }
table.push(["uArray_concat_throws_plain", "Array", "concat", false, uArray_concat_throws_plain]);
function uArray_concat_throws_tail(x: any, k: any): any { return x.concat(fail(9)); }
table.push(["uArray_concat_throws_tail", "Array", "concat", false, uArray_concat_throws_tail]);
function uArray_concat_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(fail(9)); return [r]; }
table.push(["uArray_concat_throws_loop", "Array", "concat", false, uArray_concat_throws_loop]);
function uArray_concat_throws_watched(x: any, k: any): any { try { const r = x.concat(fail(9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_concat_throws_watched", "Array", "concat", false, uArray_concat_throws_watched]);
function uArray_at_call_plain(x: any, k: any): any { const r = x.at(note("argument", 1)); return [r]; }
table.push(["uArray_at_call_plain", "Array", "at", false, uArray_at_call_plain]);
function uArray_at_call_tail(x: any, k: any): any { return x.at(note("argument", 1)); }
table.push(["uArray_at_call_tail", "Array", "at", false, uArray_at_call_tail]);
function uArray_at_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(note("argument", 1)); return [r]; }
table.push(["uArray_at_call_loop", "Array", "at", false, uArray_at_call_loop]);
function uArray_at_call_watched(x: any, k: any): any { try { const r = x.at(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_at_call_watched", "Array", "at", false, uArray_at_call_watched]);
function uArray_at_getter_plain(x: any, k: any): any { const r = x.at(holder(1).value); return [r]; }
table.push(["uArray_at_getter_plain", "Array", "at", false, uArray_at_getter_plain]);
function uArray_at_getter_tail(x: any, k: any): any { return x.at(holder(1).value); }
table.push(["uArray_at_getter_tail", "Array", "at", false, uArray_at_getter_tail]);
function uArray_at_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(holder(1).value); return [r]; }
table.push(["uArray_at_getter_loop", "Array", "at", false, uArray_at_getter_loop]);
function uArray_at_getter_watched(x: any, k: any): any { try { const r = x.at(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_at_getter_watched", "Array", "at", false, uArray_at_getter_watched]);
function uArray_at_own_plain(x: any, k: any): any { const r = x.at(alterOwn(x, "at", 1)); return [r]; }
table.push(["uArray_at_own_plain", "Array", "at", false, uArray_at_own_plain]);
function uArray_at_own_tail(x: any, k: any): any { return x.at(alterOwn(x, "at", 1)); }
table.push(["uArray_at_own_tail", "Array", "at", false, uArray_at_own_tail]);
function uArray_at_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(alterOwn(x, "at", 1)); return [r]; }
table.push(["uArray_at_own_loop", "Array", "at", false, uArray_at_own_loop]);
function uArray_at_own_watched(x: any, k: any): any { try { const r = x.at(alterOwn(x, "at", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_at_own_watched", "Array", "at", false, uArray_at_own_watched]);
function uArray_at_prototype_plain(x: any, k: any): any { const r = x.at(alterPrototype(x, "at", 1)); return [r]; }
table.push(["uArray_at_prototype_plain", "Array", "at", false, uArray_at_prototype_plain]);
function uArray_at_prototype_tail(x: any, k: any): any { return x.at(alterPrototype(x, "at", 1)); }
table.push(["uArray_at_prototype_tail", "Array", "at", false, uArray_at_prototype_tail]);
function uArray_at_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(alterPrototype(x, "at", 1)); return [r]; }
table.push(["uArray_at_prototype_loop", "Array", "at", false, uArray_at_prototype_loop]);
function uArray_at_prototype_watched(x: any, k: any): any { try { const r = x.at(alterPrototype(x, "at", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_at_prototype_watched", "Array", "at", false, uArray_at_prototype_watched]);
function uArray_at_round_plain(x: any, k: any): any { const r = x.at(addAndDelete(x, 1)); return [r]; }
table.push(["uArray_at_round_plain", "Array", "at", false, uArray_at_round_plain]);
function uArray_at_round_tail(x: any, k: any): any { return x.at(addAndDelete(x, 1)); }
table.push(["uArray_at_round_tail", "Array", "at", false, uArray_at_round_tail]);
function uArray_at_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(addAndDelete(x, 1)); return [r]; }
table.push(["uArray_at_round_loop", "Array", "at", false, uArray_at_round_loop]);
function uArray_at_round_watched(x: any, k: any): any { try { const r = x.at(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_at_round_watched", "Array", "at", false, uArray_at_round_watched]);
function uArray_at_conditional_plain(x: any, k: any): any { const r = x.at((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uArray_at_conditional_plain", "Array", "at", false, uArray_at_conditional_plain]);
function uArray_at_conditional_tail(x: any, k: any): any { return x.at((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uArray_at_conditional_tail", "Array", "at", false, uArray_at_conditional_tail]);
function uArray_at_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uArray_at_conditional_loop", "Array", "at", false, uArray_at_conditional_loop]);
function uArray_at_conditional_watched(x: any, k: any): any { try { const r = x.at((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_at_conditional_watched", "Array", "at", false, uArray_at_conditional_watched]);
function uArray_at_throws_plain(x: any, k: any): any { const r = x.at(fail(1)); return [r]; }
table.push(["uArray_at_throws_plain", "Array", "at", false, uArray_at_throws_plain]);
function uArray_at_throws_tail(x: any, k: any): any { return x.at(fail(1)); }
table.push(["uArray_at_throws_tail", "Array", "at", false, uArray_at_throws_tail]);
function uArray_at_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(fail(1)); return [r]; }
table.push(["uArray_at_throws_loop", "Array", "at", false, uArray_at_throws_loop]);
function uArray_at_throws_watched(x: any, k: any): any { try { const r = x.at(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_at_throws_watched", "Array", "at", false, uArray_at_throws_watched]);
function uArray_lastIndexOf_call_plain(x: any, k: any): any { const r = x.lastIndexOf(note("argument", 2)); return [r]; }
table.push(["uArray_lastIndexOf_call_plain", "Array", "lastIndexOf", false, uArray_lastIndexOf_call_plain]);
function uArray_lastIndexOf_call_tail(x: any, k: any): any { return x.lastIndexOf(note("argument", 2)); }
table.push(["uArray_lastIndexOf_call_tail", "Array", "lastIndexOf", false, uArray_lastIndexOf_call_tail]);
function uArray_lastIndexOf_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(note("argument", 2)); return [r]; }
table.push(["uArray_lastIndexOf_call_loop", "Array", "lastIndexOf", false, uArray_lastIndexOf_call_loop]);
function uArray_lastIndexOf_call_watched(x: any, k: any): any { try { const r = x.lastIndexOf(note("argument", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_lastIndexOf_call_watched", "Array", "lastIndexOf", false, uArray_lastIndexOf_call_watched]);
function uArray_lastIndexOf_getter_plain(x: any, k: any): any { const r = x.lastIndexOf(holder(2).value); return [r]; }
table.push(["uArray_lastIndexOf_getter_plain", "Array", "lastIndexOf", false, uArray_lastIndexOf_getter_plain]);
function uArray_lastIndexOf_getter_tail(x: any, k: any): any { return x.lastIndexOf(holder(2).value); }
table.push(["uArray_lastIndexOf_getter_tail", "Array", "lastIndexOf", false, uArray_lastIndexOf_getter_tail]);
function uArray_lastIndexOf_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(holder(2).value); return [r]; }
table.push(["uArray_lastIndexOf_getter_loop", "Array", "lastIndexOf", false, uArray_lastIndexOf_getter_loop]);
function uArray_lastIndexOf_getter_watched(x: any, k: any): any { try { const r = x.lastIndexOf(holder(2).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_lastIndexOf_getter_watched", "Array", "lastIndexOf", false, uArray_lastIndexOf_getter_watched]);
function uArray_lastIndexOf_own_plain(x: any, k: any): any { const r = x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); return [r]; }
table.push(["uArray_lastIndexOf_own_plain", "Array", "lastIndexOf", false, uArray_lastIndexOf_own_plain]);
function uArray_lastIndexOf_own_tail(x: any, k: any): any { return x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); }
table.push(["uArray_lastIndexOf_own_tail", "Array", "lastIndexOf", false, uArray_lastIndexOf_own_tail]);
function uArray_lastIndexOf_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); return [r]; }
table.push(["uArray_lastIndexOf_own_loop", "Array", "lastIndexOf", false, uArray_lastIndexOf_own_loop]);
function uArray_lastIndexOf_own_watched(x: any, k: any): any { try { const r = x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_lastIndexOf_own_watched", "Array", "lastIndexOf", false, uArray_lastIndexOf_own_watched]);
function uArray_lastIndexOf_prototype_plain(x: any, k: any): any { const r = x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); return [r]; }
table.push(["uArray_lastIndexOf_prototype_plain", "Array", "lastIndexOf", false, uArray_lastIndexOf_prototype_plain]);
function uArray_lastIndexOf_prototype_tail(x: any, k: any): any { return x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); }
table.push(["uArray_lastIndexOf_prototype_tail", "Array", "lastIndexOf", false, uArray_lastIndexOf_prototype_tail]);
function uArray_lastIndexOf_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); return [r]; }
table.push(["uArray_lastIndexOf_prototype_loop", "Array", "lastIndexOf", false, uArray_lastIndexOf_prototype_loop]);
function uArray_lastIndexOf_prototype_watched(x: any, k: any): any { try { const r = x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_lastIndexOf_prototype_watched", "Array", "lastIndexOf", false, uArray_lastIndexOf_prototype_watched]);
function uArray_lastIndexOf_round_plain(x: any, k: any): any { const r = x.lastIndexOf(addAndDelete(x, 2)); return [r]; }
table.push(["uArray_lastIndexOf_round_plain", "Array", "lastIndexOf", false, uArray_lastIndexOf_round_plain]);
function uArray_lastIndexOf_round_tail(x: any, k: any): any { return x.lastIndexOf(addAndDelete(x, 2)); }
table.push(["uArray_lastIndexOf_round_tail", "Array", "lastIndexOf", false, uArray_lastIndexOf_round_tail]);
function uArray_lastIndexOf_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(addAndDelete(x, 2)); return [r]; }
table.push(["uArray_lastIndexOf_round_loop", "Array", "lastIndexOf", false, uArray_lastIndexOf_round_loop]);
function uArray_lastIndexOf_round_watched(x: any, k: any): any { try { const r = x.lastIndexOf(addAndDelete(x, 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_lastIndexOf_round_watched", "Array", "lastIndexOf", false, uArray_lastIndexOf_round_watched]);
function uArray_lastIndexOf_conditional_plain(x: any, k: any): any { const r = x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uArray_lastIndexOf_conditional_plain", "Array", "lastIndexOf", false, uArray_lastIndexOf_conditional_plain]);
function uArray_lastIndexOf_conditional_tail(x: any, k: any): any { return x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); }
table.push(["uArray_lastIndexOf_conditional_tail", "Array", "lastIndexOf", false, uArray_lastIndexOf_conditional_tail]);
function uArray_lastIndexOf_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uArray_lastIndexOf_conditional_loop", "Array", "lastIndexOf", false, uArray_lastIndexOf_conditional_loop]);
function uArray_lastIndexOf_conditional_watched(x: any, k: any): any { try { const r = x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_lastIndexOf_conditional_watched", "Array", "lastIndexOf", false, uArray_lastIndexOf_conditional_watched]);
function uArray_lastIndexOf_throws_plain(x: any, k: any): any { const r = x.lastIndexOf(fail(2)); return [r]; }
table.push(["uArray_lastIndexOf_throws_plain", "Array", "lastIndexOf", false, uArray_lastIndexOf_throws_plain]);
function uArray_lastIndexOf_throws_tail(x: any, k: any): any { return x.lastIndexOf(fail(2)); }
table.push(["uArray_lastIndexOf_throws_tail", "Array", "lastIndexOf", false, uArray_lastIndexOf_throws_tail]);
function uArray_lastIndexOf_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(fail(2)); return [r]; }
table.push(["uArray_lastIndexOf_throws_loop", "Array", "lastIndexOf", false, uArray_lastIndexOf_throws_loop]);
function uArray_lastIndexOf_throws_watched(x: any, k: any): any { try { const r = x.lastIndexOf(fail(2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_lastIndexOf_throws_watched", "Array", "lastIndexOf", false, uArray_lastIndexOf_throws_watched]);
function uArray_fill_call_plain(x: any, k: any): any { const r = x.fill(note("argument", 7)); return [r]; }
table.push(["uArray_fill_call_plain", "Array", "fill", false, uArray_fill_call_plain]);
function uArray_fill_call_tail(x: any, k: any): any { return x.fill(note("argument", 7)); }
table.push(["uArray_fill_call_tail", "Array", "fill", false, uArray_fill_call_tail]);
function uArray_fill_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(note("argument", 7)); return [r]; }
table.push(["uArray_fill_call_loop", "Array", "fill", false, uArray_fill_call_loop]);
function uArray_fill_call_watched(x: any, k: any): any { try { const r = x.fill(note("argument", 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_fill_call_watched", "Array", "fill", false, uArray_fill_call_watched]);
function uArray_fill_getter_plain(x: any, k: any): any { const r = x.fill(holder(7).value); return [r]; }
table.push(["uArray_fill_getter_plain", "Array", "fill", false, uArray_fill_getter_plain]);
function uArray_fill_getter_tail(x: any, k: any): any { return x.fill(holder(7).value); }
table.push(["uArray_fill_getter_tail", "Array", "fill", false, uArray_fill_getter_tail]);
function uArray_fill_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(holder(7).value); return [r]; }
table.push(["uArray_fill_getter_loop", "Array", "fill", false, uArray_fill_getter_loop]);
function uArray_fill_getter_watched(x: any, k: any): any { try { const r = x.fill(holder(7).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_fill_getter_watched", "Array", "fill", false, uArray_fill_getter_watched]);
function uArray_fill_own_plain(x: any, k: any): any { const r = x.fill(alterOwn(x, "fill", 7)); return [r]; }
table.push(["uArray_fill_own_plain", "Array", "fill", false, uArray_fill_own_plain]);
function uArray_fill_own_tail(x: any, k: any): any { return x.fill(alterOwn(x, "fill", 7)); }
table.push(["uArray_fill_own_tail", "Array", "fill", false, uArray_fill_own_tail]);
function uArray_fill_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(alterOwn(x, "fill", 7)); return [r]; }
table.push(["uArray_fill_own_loop", "Array", "fill", false, uArray_fill_own_loop]);
function uArray_fill_own_watched(x: any, k: any): any { try { const r = x.fill(alterOwn(x, "fill", 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_fill_own_watched", "Array", "fill", false, uArray_fill_own_watched]);
function uArray_fill_prototype_plain(x: any, k: any): any { const r = x.fill(alterPrototype(x, "fill", 7)); return [r]; }
table.push(["uArray_fill_prototype_plain", "Array", "fill", false, uArray_fill_prototype_plain]);
function uArray_fill_prototype_tail(x: any, k: any): any { return x.fill(alterPrototype(x, "fill", 7)); }
table.push(["uArray_fill_prototype_tail", "Array", "fill", false, uArray_fill_prototype_tail]);
function uArray_fill_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(alterPrototype(x, "fill", 7)); return [r]; }
table.push(["uArray_fill_prototype_loop", "Array", "fill", false, uArray_fill_prototype_loop]);
function uArray_fill_prototype_watched(x: any, k: any): any { try { const r = x.fill(alterPrototype(x, "fill", 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_fill_prototype_watched", "Array", "fill", false, uArray_fill_prototype_watched]);
function uArray_fill_round_plain(x: any, k: any): any { const r = x.fill(addAndDelete(x, 7)); return [r]; }
table.push(["uArray_fill_round_plain", "Array", "fill", false, uArray_fill_round_plain]);
function uArray_fill_round_tail(x: any, k: any): any { return x.fill(addAndDelete(x, 7)); }
table.push(["uArray_fill_round_tail", "Array", "fill", false, uArray_fill_round_tail]);
function uArray_fill_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(addAndDelete(x, 7)); return [r]; }
table.push(["uArray_fill_round_loop", "Array", "fill", false, uArray_fill_round_loop]);
function uArray_fill_round_watched(x: any, k: any): any { try { const r = x.fill(addAndDelete(x, 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_fill_round_watched", "Array", "fill", false, uArray_fill_round_watched]);
function uArray_fill_conditional_plain(x: any, k: any): any { const r = x.fill((k ? note("yes", 7) : note("no", undefined))); return [r]; }
table.push(["uArray_fill_conditional_plain", "Array", "fill", false, uArray_fill_conditional_plain]);
function uArray_fill_conditional_tail(x: any, k: any): any { return x.fill((k ? note("yes", 7) : note("no", undefined))); }
table.push(["uArray_fill_conditional_tail", "Array", "fill", false, uArray_fill_conditional_tail]);
function uArray_fill_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill((k ? note("yes", 7) : note("no", undefined))); return [r]; }
table.push(["uArray_fill_conditional_loop", "Array", "fill", false, uArray_fill_conditional_loop]);
function uArray_fill_conditional_watched(x: any, k: any): any { try { const r = x.fill((k ? note("yes", 7) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_fill_conditional_watched", "Array", "fill", false, uArray_fill_conditional_watched]);
function uArray_fill_throws_plain(x: any, k: any): any { const r = x.fill(fail(7)); return [r]; }
table.push(["uArray_fill_throws_plain", "Array", "fill", false, uArray_fill_throws_plain]);
function uArray_fill_throws_tail(x: any, k: any): any { return x.fill(fail(7)); }
table.push(["uArray_fill_throws_tail", "Array", "fill", false, uArray_fill_throws_tail]);
function uArray_fill_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(fail(7)); return [r]; }
table.push(["uArray_fill_throws_loop", "Array", "fill", false, uArray_fill_throws_loop]);
function uArray_fill_throws_watched(x: any, k: any): any { try { const r = x.fill(fail(7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_fill_throws_watched", "Array", "fill", false, uArray_fill_throws_watched]);
function uArray_push_call_plain(x: any, k: any): any { const r = x.push(note("argument", 6), 8); return [r]; }
table.push(["uArray_push_call_plain", "Array", "push", false, uArray_push_call_plain]);
function uArray_push_call_tail(x: any, k: any): any { return x.push(note("argument", 6), 8); }
table.push(["uArray_push_call_tail", "Array", "push", false, uArray_push_call_tail]);
function uArray_push_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(note("argument", 6), 8); return [r]; }
table.push(["uArray_push_call_loop", "Array", "push", false, uArray_push_call_loop]);
function uArray_push_call_watched(x: any, k: any): any { try { const r = x.push(note("argument", 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_push_call_watched", "Array", "push", false, uArray_push_call_watched]);
function uArray_push_getter_plain(x: any, k: any): any { const r = x.push(holder(6).value, 8); return [r]; }
table.push(["uArray_push_getter_plain", "Array", "push", false, uArray_push_getter_plain]);
function uArray_push_getter_tail(x: any, k: any): any { return x.push(holder(6).value, 8); }
table.push(["uArray_push_getter_tail", "Array", "push", false, uArray_push_getter_tail]);
function uArray_push_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(holder(6).value, 8); return [r]; }
table.push(["uArray_push_getter_loop", "Array", "push", false, uArray_push_getter_loop]);
function uArray_push_getter_watched(x: any, k: any): any { try { const r = x.push(holder(6).value, 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_push_getter_watched", "Array", "push", false, uArray_push_getter_watched]);
function uArray_push_own_plain(x: any, k: any): any { const r = x.push(alterOwn(x, "push", 6), 8); return [r]; }
table.push(["uArray_push_own_plain", "Array", "push", false, uArray_push_own_plain]);
function uArray_push_own_tail(x: any, k: any): any { return x.push(alterOwn(x, "push", 6), 8); }
table.push(["uArray_push_own_tail", "Array", "push", false, uArray_push_own_tail]);
function uArray_push_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(alterOwn(x, "push", 6), 8); return [r]; }
table.push(["uArray_push_own_loop", "Array", "push", false, uArray_push_own_loop]);
function uArray_push_own_watched(x: any, k: any): any { try { const r = x.push(alterOwn(x, "push", 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_push_own_watched", "Array", "push", false, uArray_push_own_watched]);
function uArray_push_prototype_plain(x: any, k: any): any { const r = x.push(alterPrototype(x, "push", 6), 8); return [r]; }
table.push(["uArray_push_prototype_plain", "Array", "push", false, uArray_push_prototype_plain]);
function uArray_push_prototype_tail(x: any, k: any): any { return x.push(alterPrototype(x, "push", 6), 8); }
table.push(["uArray_push_prototype_tail", "Array", "push", false, uArray_push_prototype_tail]);
function uArray_push_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(alterPrototype(x, "push", 6), 8); return [r]; }
table.push(["uArray_push_prototype_loop", "Array", "push", false, uArray_push_prototype_loop]);
function uArray_push_prototype_watched(x: any, k: any): any { try { const r = x.push(alterPrototype(x, "push", 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_push_prototype_watched", "Array", "push", false, uArray_push_prototype_watched]);
function uArray_push_round_plain(x: any, k: any): any { const r = x.push(addAndDelete(x, 6), 8); return [r]; }
table.push(["uArray_push_round_plain", "Array", "push", false, uArray_push_round_plain]);
function uArray_push_round_tail(x: any, k: any): any { return x.push(addAndDelete(x, 6), 8); }
table.push(["uArray_push_round_tail", "Array", "push", false, uArray_push_round_tail]);
function uArray_push_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(addAndDelete(x, 6), 8); return [r]; }
table.push(["uArray_push_round_loop", "Array", "push", false, uArray_push_round_loop]);
function uArray_push_round_watched(x: any, k: any): any { try { const r = x.push(addAndDelete(x, 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_push_round_watched", "Array", "push", false, uArray_push_round_watched]);
function uArray_push_conditional_plain(x: any, k: any): any { const r = x.push((k ? note("yes", 6) : note("no", undefined)), 8); return [r]; }
table.push(["uArray_push_conditional_plain", "Array", "push", false, uArray_push_conditional_plain]);
function uArray_push_conditional_tail(x: any, k: any): any { return x.push((k ? note("yes", 6) : note("no", undefined)), 8); }
table.push(["uArray_push_conditional_tail", "Array", "push", false, uArray_push_conditional_tail]);
function uArray_push_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push((k ? note("yes", 6) : note("no", undefined)), 8); return [r]; }
table.push(["uArray_push_conditional_loop", "Array", "push", false, uArray_push_conditional_loop]);
function uArray_push_conditional_watched(x: any, k: any): any { try { const r = x.push((k ? note("yes", 6) : note("no", undefined)), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_push_conditional_watched", "Array", "push", false, uArray_push_conditional_watched]);
function uArray_push_throws_plain(x: any, k: any): any { const r = x.push(fail(6), 8); return [r]; }
table.push(["uArray_push_throws_plain", "Array", "push", false, uArray_push_throws_plain]);
function uArray_push_throws_tail(x: any, k: any): any { return x.push(fail(6), 8); }
table.push(["uArray_push_throws_tail", "Array", "push", false, uArray_push_throws_tail]);
function uArray_push_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(fail(6), 8); return [r]; }
table.push(["uArray_push_throws_loop", "Array", "push", false, uArray_push_throws_loop]);
function uArray_push_throws_watched(x: any, k: any): any { try { const r = x.push(fail(6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_push_throws_watched", "Array", "push", false, uArray_push_throws_watched]);
function uArray_unshift_call_plain(x: any, k: any): any { const r = x.unshift(note("argument", 5)); return [r]; }
table.push(["uArray_unshift_call_plain", "Array", "unshift", false, uArray_unshift_call_plain]);
function uArray_unshift_call_tail(x: any, k: any): any { return x.unshift(note("argument", 5)); }
table.push(["uArray_unshift_call_tail", "Array", "unshift", false, uArray_unshift_call_tail]);
function uArray_unshift_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(note("argument", 5)); return [r]; }
table.push(["uArray_unshift_call_loop", "Array", "unshift", false, uArray_unshift_call_loop]);
function uArray_unshift_call_watched(x: any, k: any): any { try { const r = x.unshift(note("argument", 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_unshift_call_watched", "Array", "unshift", false, uArray_unshift_call_watched]);
function uArray_unshift_getter_plain(x: any, k: any): any { const r = x.unshift(holder(5).value); return [r]; }
table.push(["uArray_unshift_getter_plain", "Array", "unshift", false, uArray_unshift_getter_plain]);
function uArray_unshift_getter_tail(x: any, k: any): any { return x.unshift(holder(5).value); }
table.push(["uArray_unshift_getter_tail", "Array", "unshift", false, uArray_unshift_getter_tail]);
function uArray_unshift_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(holder(5).value); return [r]; }
table.push(["uArray_unshift_getter_loop", "Array", "unshift", false, uArray_unshift_getter_loop]);
function uArray_unshift_getter_watched(x: any, k: any): any { try { const r = x.unshift(holder(5).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_unshift_getter_watched", "Array", "unshift", false, uArray_unshift_getter_watched]);
function uArray_unshift_own_plain(x: any, k: any): any { const r = x.unshift(alterOwn(x, "unshift", 5)); return [r]; }
table.push(["uArray_unshift_own_plain", "Array", "unshift", false, uArray_unshift_own_plain]);
function uArray_unshift_own_tail(x: any, k: any): any { return x.unshift(alterOwn(x, "unshift", 5)); }
table.push(["uArray_unshift_own_tail", "Array", "unshift", false, uArray_unshift_own_tail]);
function uArray_unshift_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(alterOwn(x, "unshift", 5)); return [r]; }
table.push(["uArray_unshift_own_loop", "Array", "unshift", false, uArray_unshift_own_loop]);
function uArray_unshift_own_watched(x: any, k: any): any { try { const r = x.unshift(alterOwn(x, "unshift", 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_unshift_own_watched", "Array", "unshift", false, uArray_unshift_own_watched]);
function uArray_unshift_prototype_plain(x: any, k: any): any { const r = x.unshift(alterPrototype(x, "unshift", 5)); return [r]; }
table.push(["uArray_unshift_prototype_plain", "Array", "unshift", false, uArray_unshift_prototype_plain]);
function uArray_unshift_prototype_tail(x: any, k: any): any { return x.unshift(alterPrototype(x, "unshift", 5)); }
table.push(["uArray_unshift_prototype_tail", "Array", "unshift", false, uArray_unshift_prototype_tail]);
function uArray_unshift_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(alterPrototype(x, "unshift", 5)); return [r]; }
table.push(["uArray_unshift_prototype_loop", "Array", "unshift", false, uArray_unshift_prototype_loop]);
function uArray_unshift_prototype_watched(x: any, k: any): any { try { const r = x.unshift(alterPrototype(x, "unshift", 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_unshift_prototype_watched", "Array", "unshift", false, uArray_unshift_prototype_watched]);
function uArray_unshift_round_plain(x: any, k: any): any { const r = x.unshift(addAndDelete(x, 5)); return [r]; }
table.push(["uArray_unshift_round_plain", "Array", "unshift", false, uArray_unshift_round_plain]);
function uArray_unshift_round_tail(x: any, k: any): any { return x.unshift(addAndDelete(x, 5)); }
table.push(["uArray_unshift_round_tail", "Array", "unshift", false, uArray_unshift_round_tail]);
function uArray_unshift_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(addAndDelete(x, 5)); return [r]; }
table.push(["uArray_unshift_round_loop", "Array", "unshift", false, uArray_unshift_round_loop]);
function uArray_unshift_round_watched(x: any, k: any): any { try { const r = x.unshift(addAndDelete(x, 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_unshift_round_watched", "Array", "unshift", false, uArray_unshift_round_watched]);
function uArray_unshift_conditional_plain(x: any, k: any): any { const r = x.unshift((k ? note("yes", 5) : note("no", undefined))); return [r]; }
table.push(["uArray_unshift_conditional_plain", "Array", "unshift", false, uArray_unshift_conditional_plain]);
function uArray_unshift_conditional_tail(x: any, k: any): any { return x.unshift((k ? note("yes", 5) : note("no", undefined))); }
table.push(["uArray_unshift_conditional_tail", "Array", "unshift", false, uArray_unshift_conditional_tail]);
function uArray_unshift_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift((k ? note("yes", 5) : note("no", undefined))); return [r]; }
table.push(["uArray_unshift_conditional_loop", "Array", "unshift", false, uArray_unshift_conditional_loop]);
function uArray_unshift_conditional_watched(x: any, k: any): any { try { const r = x.unshift((k ? note("yes", 5) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_unshift_conditional_watched", "Array", "unshift", false, uArray_unshift_conditional_watched]);
function uArray_unshift_throws_plain(x: any, k: any): any { const r = x.unshift(fail(5)); return [r]; }
table.push(["uArray_unshift_throws_plain", "Array", "unshift", false, uArray_unshift_throws_plain]);
function uArray_unshift_throws_tail(x: any, k: any): any { return x.unshift(fail(5)); }
table.push(["uArray_unshift_throws_tail", "Array", "unshift", false, uArray_unshift_throws_tail]);
function uArray_unshift_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(fail(5)); return [r]; }
table.push(["uArray_unshift_throws_loop", "Array", "unshift", false, uArray_unshift_throws_loop]);
function uArray_unshift_throws_watched(x: any, k: any): any { try { const r = x.unshift(fail(5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_unshift_throws_watched", "Array", "unshift", false, uArray_unshift_throws_watched]);
function uArray_splice_call_plain(x: any, k: any): any { const r = x.splice(note("argument", 1), 1); return [r]; }
table.push(["uArray_splice_call_plain", "Array", "splice", false, uArray_splice_call_plain]);
function uArray_splice_call_tail(x: any, k: any): any { return x.splice(note("argument", 1), 1); }
table.push(["uArray_splice_call_tail", "Array", "splice", false, uArray_splice_call_tail]);
function uArray_splice_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(note("argument", 1), 1); return [r]; }
table.push(["uArray_splice_call_loop", "Array", "splice", false, uArray_splice_call_loop]);
function uArray_splice_call_watched(x: any, k: any): any { try { const r = x.splice(note("argument", 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_splice_call_watched", "Array", "splice", false, uArray_splice_call_watched]);
function uArray_splice_getter_plain(x: any, k: any): any { const r = x.splice(holder(1).value, 1); return [r]; }
table.push(["uArray_splice_getter_plain", "Array", "splice", false, uArray_splice_getter_plain]);
function uArray_splice_getter_tail(x: any, k: any): any { return x.splice(holder(1).value, 1); }
table.push(["uArray_splice_getter_tail", "Array", "splice", false, uArray_splice_getter_tail]);
function uArray_splice_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(holder(1).value, 1); return [r]; }
table.push(["uArray_splice_getter_loop", "Array", "splice", false, uArray_splice_getter_loop]);
function uArray_splice_getter_watched(x: any, k: any): any { try { const r = x.splice(holder(1).value, 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_splice_getter_watched", "Array", "splice", false, uArray_splice_getter_watched]);
function uArray_splice_own_plain(x: any, k: any): any { const r = x.splice(alterOwn(x, "splice", 1), 1); return [r]; }
table.push(["uArray_splice_own_plain", "Array", "splice", false, uArray_splice_own_plain]);
function uArray_splice_own_tail(x: any, k: any): any { return x.splice(alterOwn(x, "splice", 1), 1); }
table.push(["uArray_splice_own_tail", "Array", "splice", false, uArray_splice_own_tail]);
function uArray_splice_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(alterOwn(x, "splice", 1), 1); return [r]; }
table.push(["uArray_splice_own_loop", "Array", "splice", false, uArray_splice_own_loop]);
function uArray_splice_own_watched(x: any, k: any): any { try { const r = x.splice(alterOwn(x, "splice", 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_splice_own_watched", "Array", "splice", false, uArray_splice_own_watched]);
function uArray_splice_prototype_plain(x: any, k: any): any { const r = x.splice(alterPrototype(x, "splice", 1), 1); return [r]; }
table.push(["uArray_splice_prototype_plain", "Array", "splice", false, uArray_splice_prototype_plain]);
function uArray_splice_prototype_tail(x: any, k: any): any { return x.splice(alterPrototype(x, "splice", 1), 1); }
table.push(["uArray_splice_prototype_tail", "Array", "splice", false, uArray_splice_prototype_tail]);
function uArray_splice_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(alterPrototype(x, "splice", 1), 1); return [r]; }
table.push(["uArray_splice_prototype_loop", "Array", "splice", false, uArray_splice_prototype_loop]);
function uArray_splice_prototype_watched(x: any, k: any): any { try { const r = x.splice(alterPrototype(x, "splice", 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_splice_prototype_watched", "Array", "splice", false, uArray_splice_prototype_watched]);
function uArray_splice_round_plain(x: any, k: any): any { const r = x.splice(addAndDelete(x, 1), 1); return [r]; }
table.push(["uArray_splice_round_plain", "Array", "splice", false, uArray_splice_round_plain]);
function uArray_splice_round_tail(x: any, k: any): any { return x.splice(addAndDelete(x, 1), 1); }
table.push(["uArray_splice_round_tail", "Array", "splice", false, uArray_splice_round_tail]);
function uArray_splice_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(addAndDelete(x, 1), 1); return [r]; }
table.push(["uArray_splice_round_loop", "Array", "splice", false, uArray_splice_round_loop]);
function uArray_splice_round_watched(x: any, k: any): any { try { const r = x.splice(addAndDelete(x, 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_splice_round_watched", "Array", "splice", false, uArray_splice_round_watched]);
function uArray_splice_conditional_plain(x: any, k: any): any { const r = x.splice((k ? note("yes", 1) : note("no", undefined)), 1); return [r]; }
table.push(["uArray_splice_conditional_plain", "Array", "splice", false, uArray_splice_conditional_plain]);
function uArray_splice_conditional_tail(x: any, k: any): any { return x.splice((k ? note("yes", 1) : note("no", undefined)), 1); }
table.push(["uArray_splice_conditional_tail", "Array", "splice", false, uArray_splice_conditional_tail]);
function uArray_splice_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice((k ? note("yes", 1) : note("no", undefined)), 1); return [r]; }
table.push(["uArray_splice_conditional_loop", "Array", "splice", false, uArray_splice_conditional_loop]);
function uArray_splice_conditional_watched(x: any, k: any): any { try { const r = x.splice((k ? note("yes", 1) : note("no", undefined)), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_splice_conditional_watched", "Array", "splice", false, uArray_splice_conditional_watched]);
function uArray_splice_throws_plain(x: any, k: any): any { const r = x.splice(fail(1), 1); return [r]; }
table.push(["uArray_splice_throws_plain", "Array", "splice", false, uArray_splice_throws_plain]);
function uArray_splice_throws_tail(x: any, k: any): any { return x.splice(fail(1), 1); }
table.push(["uArray_splice_throws_tail", "Array", "splice", false, uArray_splice_throws_tail]);
function uArray_splice_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(fail(1), 1); return [r]; }
table.push(["uArray_splice_throws_loop", "Array", "splice", false, uArray_splice_throws_loop]);
function uArray_splice_throws_watched(x: any, k: any): any { try { const r = x.splice(fail(1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_splice_throws_watched", "Array", "splice", false, uArray_splice_throws_watched]);
function uArray_with_call_plain(x: any, k: any): any { const r = x.with(note("argument", 0), 9); return [r]; }
table.push(["uArray_with_call_plain", "Array", "with", false, uArray_with_call_plain]);
function uArray_with_call_tail(x: any, k: any): any { return x.with(note("argument", 0), 9); }
table.push(["uArray_with_call_tail", "Array", "with", false, uArray_with_call_tail]);
function uArray_with_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(note("argument", 0), 9); return [r]; }
table.push(["uArray_with_call_loop", "Array", "with", false, uArray_with_call_loop]);
function uArray_with_call_watched(x: any, k: any): any { try { const r = x.with(note("argument", 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_with_call_watched", "Array", "with", false, uArray_with_call_watched]);
function uArray_with_getter_plain(x: any, k: any): any { const r = x.with(holder(0).value, 9); return [r]; }
table.push(["uArray_with_getter_plain", "Array", "with", false, uArray_with_getter_plain]);
function uArray_with_getter_tail(x: any, k: any): any { return x.with(holder(0).value, 9); }
table.push(["uArray_with_getter_tail", "Array", "with", false, uArray_with_getter_tail]);
function uArray_with_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(holder(0).value, 9); return [r]; }
table.push(["uArray_with_getter_loop", "Array", "with", false, uArray_with_getter_loop]);
function uArray_with_getter_watched(x: any, k: any): any { try { const r = x.with(holder(0).value, 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_with_getter_watched", "Array", "with", false, uArray_with_getter_watched]);
function uArray_with_own_plain(x: any, k: any): any { const r = x.with(alterOwn(x, "with", 0), 9); return [r]; }
table.push(["uArray_with_own_plain", "Array", "with", false, uArray_with_own_plain]);
function uArray_with_own_tail(x: any, k: any): any { return x.with(alterOwn(x, "with", 0), 9); }
table.push(["uArray_with_own_tail", "Array", "with", false, uArray_with_own_tail]);
function uArray_with_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(alterOwn(x, "with", 0), 9); return [r]; }
table.push(["uArray_with_own_loop", "Array", "with", false, uArray_with_own_loop]);
function uArray_with_own_watched(x: any, k: any): any { try { const r = x.with(alterOwn(x, "with", 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_with_own_watched", "Array", "with", false, uArray_with_own_watched]);
function uArray_with_prototype_plain(x: any, k: any): any { const r = x.with(alterPrototype(x, "with", 0), 9); return [r]; }
table.push(["uArray_with_prototype_plain", "Array", "with", false, uArray_with_prototype_plain]);
function uArray_with_prototype_tail(x: any, k: any): any { return x.with(alterPrototype(x, "with", 0), 9); }
table.push(["uArray_with_prototype_tail", "Array", "with", false, uArray_with_prototype_tail]);
function uArray_with_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(alterPrototype(x, "with", 0), 9); return [r]; }
table.push(["uArray_with_prototype_loop", "Array", "with", false, uArray_with_prototype_loop]);
function uArray_with_prototype_watched(x: any, k: any): any { try { const r = x.with(alterPrototype(x, "with", 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_with_prototype_watched", "Array", "with", false, uArray_with_prototype_watched]);
function uArray_with_round_plain(x: any, k: any): any { const r = x.with(addAndDelete(x, 0), 9); return [r]; }
table.push(["uArray_with_round_plain", "Array", "with", false, uArray_with_round_plain]);
function uArray_with_round_tail(x: any, k: any): any { return x.with(addAndDelete(x, 0), 9); }
table.push(["uArray_with_round_tail", "Array", "with", false, uArray_with_round_tail]);
function uArray_with_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(addAndDelete(x, 0), 9); return [r]; }
table.push(["uArray_with_round_loop", "Array", "with", false, uArray_with_round_loop]);
function uArray_with_round_watched(x: any, k: any): any { try { const r = x.with(addAndDelete(x, 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_with_round_watched", "Array", "with", false, uArray_with_round_watched]);
function uArray_with_conditional_plain(x: any, k: any): any { const r = x.with((k ? note("yes", 0) : note("no", undefined)), 9); return [r]; }
table.push(["uArray_with_conditional_plain", "Array", "with", false, uArray_with_conditional_plain]);
function uArray_with_conditional_tail(x: any, k: any): any { return x.with((k ? note("yes", 0) : note("no", undefined)), 9); }
table.push(["uArray_with_conditional_tail", "Array", "with", false, uArray_with_conditional_tail]);
function uArray_with_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with((k ? note("yes", 0) : note("no", undefined)), 9); return [r]; }
table.push(["uArray_with_conditional_loop", "Array", "with", false, uArray_with_conditional_loop]);
function uArray_with_conditional_watched(x: any, k: any): any { try { const r = x.with((k ? note("yes", 0) : note("no", undefined)), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_with_conditional_watched", "Array", "with", false, uArray_with_conditional_watched]);
function uArray_with_throws_plain(x: any, k: any): any { const r = x.with(fail(0), 9); return [r]; }
table.push(["uArray_with_throws_plain", "Array", "with", false, uArray_with_throws_plain]);
function uArray_with_throws_tail(x: any, k: any): any { return x.with(fail(0), 9); }
table.push(["uArray_with_throws_tail", "Array", "with", false, uArray_with_throws_tail]);
function uArray_with_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(fail(0), 9); return [r]; }
table.push(["uArray_with_throws_loop", "Array", "with", false, uArray_with_throws_loop]);
function uArray_with_throws_watched(x: any, k: any): any { try { const r = x.with(fail(0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_with_throws_watched", "Array", "with", false, uArray_with_throws_watched]);
function uArray_flat_call_plain(x: any, k: any): any { const r = x.flat(note("argument", 1)); return [r]; }
table.push(["uArray_flat_call_plain", "Array", "flat", false, uArray_flat_call_plain]);
function uArray_flat_call_tail(x: any, k: any): any { return x.flat(note("argument", 1)); }
table.push(["uArray_flat_call_tail", "Array", "flat", false, uArray_flat_call_tail]);
function uArray_flat_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(note("argument", 1)); return [r]; }
table.push(["uArray_flat_call_loop", "Array", "flat", false, uArray_flat_call_loop]);
function uArray_flat_call_watched(x: any, k: any): any { try { const r = x.flat(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_flat_call_watched", "Array", "flat", false, uArray_flat_call_watched]);
function uArray_flat_getter_plain(x: any, k: any): any { const r = x.flat(holder(1).value); return [r]; }
table.push(["uArray_flat_getter_plain", "Array", "flat", false, uArray_flat_getter_plain]);
function uArray_flat_getter_tail(x: any, k: any): any { return x.flat(holder(1).value); }
table.push(["uArray_flat_getter_tail", "Array", "flat", false, uArray_flat_getter_tail]);
function uArray_flat_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(holder(1).value); return [r]; }
table.push(["uArray_flat_getter_loop", "Array", "flat", false, uArray_flat_getter_loop]);
function uArray_flat_getter_watched(x: any, k: any): any { try { const r = x.flat(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_flat_getter_watched", "Array", "flat", false, uArray_flat_getter_watched]);
function uArray_flat_own_plain(x: any, k: any): any { const r = x.flat(alterOwn(x, "flat", 1)); return [r]; }
table.push(["uArray_flat_own_plain", "Array", "flat", false, uArray_flat_own_plain]);
function uArray_flat_own_tail(x: any, k: any): any { return x.flat(alterOwn(x, "flat", 1)); }
table.push(["uArray_flat_own_tail", "Array", "flat", false, uArray_flat_own_tail]);
function uArray_flat_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(alterOwn(x, "flat", 1)); return [r]; }
table.push(["uArray_flat_own_loop", "Array", "flat", false, uArray_flat_own_loop]);
function uArray_flat_own_watched(x: any, k: any): any { try { const r = x.flat(alterOwn(x, "flat", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_flat_own_watched", "Array", "flat", false, uArray_flat_own_watched]);
function uArray_flat_prototype_plain(x: any, k: any): any { const r = x.flat(alterPrototype(x, "flat", 1)); return [r]; }
table.push(["uArray_flat_prototype_plain", "Array", "flat", false, uArray_flat_prototype_plain]);
function uArray_flat_prototype_tail(x: any, k: any): any { return x.flat(alterPrototype(x, "flat", 1)); }
table.push(["uArray_flat_prototype_tail", "Array", "flat", false, uArray_flat_prototype_tail]);
function uArray_flat_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(alterPrototype(x, "flat", 1)); return [r]; }
table.push(["uArray_flat_prototype_loop", "Array", "flat", false, uArray_flat_prototype_loop]);
function uArray_flat_prototype_watched(x: any, k: any): any { try { const r = x.flat(alterPrototype(x, "flat", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_flat_prototype_watched", "Array", "flat", false, uArray_flat_prototype_watched]);
function uArray_flat_round_plain(x: any, k: any): any { const r = x.flat(addAndDelete(x, 1)); return [r]; }
table.push(["uArray_flat_round_plain", "Array", "flat", false, uArray_flat_round_plain]);
function uArray_flat_round_tail(x: any, k: any): any { return x.flat(addAndDelete(x, 1)); }
table.push(["uArray_flat_round_tail", "Array", "flat", false, uArray_flat_round_tail]);
function uArray_flat_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(addAndDelete(x, 1)); return [r]; }
table.push(["uArray_flat_round_loop", "Array", "flat", false, uArray_flat_round_loop]);
function uArray_flat_round_watched(x: any, k: any): any { try { const r = x.flat(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_flat_round_watched", "Array", "flat", false, uArray_flat_round_watched]);
function uArray_flat_conditional_plain(x: any, k: any): any { const r = x.flat((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uArray_flat_conditional_plain", "Array", "flat", false, uArray_flat_conditional_plain]);
function uArray_flat_conditional_tail(x: any, k: any): any { return x.flat((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uArray_flat_conditional_tail", "Array", "flat", false, uArray_flat_conditional_tail]);
function uArray_flat_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uArray_flat_conditional_loop", "Array", "flat", false, uArray_flat_conditional_loop]);
function uArray_flat_conditional_watched(x: any, k: any): any { try { const r = x.flat((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_flat_conditional_watched", "Array", "flat", false, uArray_flat_conditional_watched]);
function uArray_flat_throws_plain(x: any, k: any): any { const r = x.flat(fail(1)); return [r]; }
table.push(["uArray_flat_throws_plain", "Array", "flat", false, uArray_flat_throws_plain]);
function uArray_flat_throws_tail(x: any, k: any): any { return x.flat(fail(1)); }
table.push(["uArray_flat_throws_tail", "Array", "flat", false, uArray_flat_throws_tail]);
function uArray_flat_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(fail(1)); return [r]; }
table.push(["uArray_flat_throws_loop", "Array", "flat", false, uArray_flat_throws_loop]);
function uArray_flat_throws_watched(x: any, k: any): any { try { const r = x.flat(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_flat_throws_watched", "Array", "flat", false, uArray_flat_throws_watched]);
function uArray_toSpliced_call_plain(x: any, k: any): any { const r = x.toSpliced(note("argument", 0), 1); return [r]; }
table.push(["uArray_toSpliced_call_plain", "Array", "toSpliced", false, uArray_toSpliced_call_plain]);
function uArray_toSpliced_call_tail(x: any, k: any): any { return x.toSpliced(note("argument", 0), 1); }
table.push(["uArray_toSpliced_call_tail", "Array", "toSpliced", false, uArray_toSpliced_call_tail]);
function uArray_toSpliced_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(note("argument", 0), 1); return [r]; }
table.push(["uArray_toSpliced_call_loop", "Array", "toSpliced", false, uArray_toSpliced_call_loop]);
function uArray_toSpliced_call_watched(x: any, k: any): any { try { const r = x.toSpliced(note("argument", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_toSpliced_call_watched", "Array", "toSpliced", false, uArray_toSpliced_call_watched]);
function uArray_toSpliced_getter_plain(x: any, k: any): any { const r = x.toSpliced(holder(0).value, 1); return [r]; }
table.push(["uArray_toSpliced_getter_plain", "Array", "toSpliced", false, uArray_toSpliced_getter_plain]);
function uArray_toSpliced_getter_tail(x: any, k: any): any { return x.toSpliced(holder(0).value, 1); }
table.push(["uArray_toSpliced_getter_tail", "Array", "toSpliced", false, uArray_toSpliced_getter_tail]);
function uArray_toSpliced_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(holder(0).value, 1); return [r]; }
table.push(["uArray_toSpliced_getter_loop", "Array", "toSpliced", false, uArray_toSpliced_getter_loop]);
function uArray_toSpliced_getter_watched(x: any, k: any): any { try { const r = x.toSpliced(holder(0).value, 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_toSpliced_getter_watched", "Array", "toSpliced", false, uArray_toSpliced_getter_watched]);
function uArray_toSpliced_own_plain(x: any, k: any): any { const r = x.toSpliced(alterOwn(x, "toSpliced", 0), 1); return [r]; }
table.push(["uArray_toSpliced_own_plain", "Array", "toSpliced", false, uArray_toSpliced_own_plain]);
function uArray_toSpliced_own_tail(x: any, k: any): any { return x.toSpliced(alterOwn(x, "toSpliced", 0), 1); }
table.push(["uArray_toSpliced_own_tail", "Array", "toSpliced", false, uArray_toSpliced_own_tail]);
function uArray_toSpliced_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(alterOwn(x, "toSpliced", 0), 1); return [r]; }
table.push(["uArray_toSpliced_own_loop", "Array", "toSpliced", false, uArray_toSpliced_own_loop]);
function uArray_toSpliced_own_watched(x: any, k: any): any { try { const r = x.toSpliced(alterOwn(x, "toSpliced", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_toSpliced_own_watched", "Array", "toSpliced", false, uArray_toSpliced_own_watched]);
function uArray_toSpliced_prototype_plain(x: any, k: any): any { const r = x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); return [r]; }
table.push(["uArray_toSpliced_prototype_plain", "Array", "toSpliced", false, uArray_toSpliced_prototype_plain]);
function uArray_toSpliced_prototype_tail(x: any, k: any): any { return x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); }
table.push(["uArray_toSpliced_prototype_tail", "Array", "toSpliced", false, uArray_toSpliced_prototype_tail]);
function uArray_toSpliced_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); return [r]; }
table.push(["uArray_toSpliced_prototype_loop", "Array", "toSpliced", false, uArray_toSpliced_prototype_loop]);
function uArray_toSpliced_prototype_watched(x: any, k: any): any { try { const r = x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_toSpliced_prototype_watched", "Array", "toSpliced", false, uArray_toSpliced_prototype_watched]);
function uArray_toSpliced_round_plain(x: any, k: any): any { const r = x.toSpliced(addAndDelete(x, 0), 1); return [r]; }
table.push(["uArray_toSpliced_round_plain", "Array", "toSpliced", false, uArray_toSpliced_round_plain]);
function uArray_toSpliced_round_tail(x: any, k: any): any { return x.toSpliced(addAndDelete(x, 0), 1); }
table.push(["uArray_toSpliced_round_tail", "Array", "toSpliced", false, uArray_toSpliced_round_tail]);
function uArray_toSpliced_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(addAndDelete(x, 0), 1); return [r]; }
table.push(["uArray_toSpliced_round_loop", "Array", "toSpliced", false, uArray_toSpliced_round_loop]);
function uArray_toSpliced_round_watched(x: any, k: any): any { try { const r = x.toSpliced(addAndDelete(x, 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_toSpliced_round_watched", "Array", "toSpliced", false, uArray_toSpliced_round_watched]);
function uArray_toSpliced_conditional_plain(x: any, k: any): any { const r = x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["uArray_toSpliced_conditional_plain", "Array", "toSpliced", false, uArray_toSpliced_conditional_plain]);
function uArray_toSpliced_conditional_tail(x: any, k: any): any { return x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); }
table.push(["uArray_toSpliced_conditional_tail", "Array", "toSpliced", false, uArray_toSpliced_conditional_tail]);
function uArray_toSpliced_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["uArray_toSpliced_conditional_loop", "Array", "toSpliced", false, uArray_toSpliced_conditional_loop]);
function uArray_toSpliced_conditional_watched(x: any, k: any): any { try { const r = x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_toSpliced_conditional_watched", "Array", "toSpliced", false, uArray_toSpliced_conditional_watched]);
function uArray_toSpliced_throws_plain(x: any, k: any): any { const r = x.toSpliced(fail(0), 1); return [r]; }
table.push(["uArray_toSpliced_throws_plain", "Array", "toSpliced", false, uArray_toSpliced_throws_plain]);
function uArray_toSpliced_throws_tail(x: any, k: any): any { return x.toSpliced(fail(0), 1); }
table.push(["uArray_toSpliced_throws_tail", "Array", "toSpliced", false, uArray_toSpliced_throws_tail]);
function uArray_toSpliced_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(fail(0), 1); return [r]; }
table.push(["uArray_toSpliced_throws_loop", "Array", "toSpliced", false, uArray_toSpliced_throws_loop]);
function uArray_toSpliced_throws_watched(x: any, k: any): any { try { const r = x.toSpliced(fail(0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_toSpliced_throws_watched", "Array", "toSpliced", false, uArray_toSpliced_throws_watched]);
function uArray_copyWithin_call_plain(x: any, k: any): any { const r = x.copyWithin(note("argument", 0), 1); return [r]; }
table.push(["uArray_copyWithin_call_plain", "Array", "copyWithin", false, uArray_copyWithin_call_plain]);
function uArray_copyWithin_call_tail(x: any, k: any): any { return x.copyWithin(note("argument", 0), 1); }
table.push(["uArray_copyWithin_call_tail", "Array", "copyWithin", false, uArray_copyWithin_call_tail]);
function uArray_copyWithin_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(note("argument", 0), 1); return [r]; }
table.push(["uArray_copyWithin_call_loop", "Array", "copyWithin", false, uArray_copyWithin_call_loop]);
function uArray_copyWithin_call_watched(x: any, k: any): any { try { const r = x.copyWithin(note("argument", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_copyWithin_call_watched", "Array", "copyWithin", false, uArray_copyWithin_call_watched]);
function uArray_copyWithin_getter_plain(x: any, k: any): any { const r = x.copyWithin(holder(0).value, 1); return [r]; }
table.push(["uArray_copyWithin_getter_plain", "Array", "copyWithin", false, uArray_copyWithin_getter_plain]);
function uArray_copyWithin_getter_tail(x: any, k: any): any { return x.copyWithin(holder(0).value, 1); }
table.push(["uArray_copyWithin_getter_tail", "Array", "copyWithin", false, uArray_copyWithin_getter_tail]);
function uArray_copyWithin_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(holder(0).value, 1); return [r]; }
table.push(["uArray_copyWithin_getter_loop", "Array", "copyWithin", false, uArray_copyWithin_getter_loop]);
function uArray_copyWithin_getter_watched(x: any, k: any): any { try { const r = x.copyWithin(holder(0).value, 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_copyWithin_getter_watched", "Array", "copyWithin", false, uArray_copyWithin_getter_watched]);
function uArray_copyWithin_own_plain(x: any, k: any): any { const r = x.copyWithin(alterOwn(x, "copyWithin", 0), 1); return [r]; }
table.push(["uArray_copyWithin_own_plain", "Array", "copyWithin", false, uArray_copyWithin_own_plain]);
function uArray_copyWithin_own_tail(x: any, k: any): any { return x.copyWithin(alterOwn(x, "copyWithin", 0), 1); }
table.push(["uArray_copyWithin_own_tail", "Array", "copyWithin", false, uArray_copyWithin_own_tail]);
function uArray_copyWithin_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(alterOwn(x, "copyWithin", 0), 1); return [r]; }
table.push(["uArray_copyWithin_own_loop", "Array", "copyWithin", false, uArray_copyWithin_own_loop]);
function uArray_copyWithin_own_watched(x: any, k: any): any { try { const r = x.copyWithin(alterOwn(x, "copyWithin", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_copyWithin_own_watched", "Array", "copyWithin", false, uArray_copyWithin_own_watched]);
function uArray_copyWithin_prototype_plain(x: any, k: any): any { const r = x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); return [r]; }
table.push(["uArray_copyWithin_prototype_plain", "Array", "copyWithin", false, uArray_copyWithin_prototype_plain]);
function uArray_copyWithin_prototype_tail(x: any, k: any): any { return x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); }
table.push(["uArray_copyWithin_prototype_tail", "Array", "copyWithin", false, uArray_copyWithin_prototype_tail]);
function uArray_copyWithin_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); return [r]; }
table.push(["uArray_copyWithin_prototype_loop", "Array", "copyWithin", false, uArray_copyWithin_prototype_loop]);
function uArray_copyWithin_prototype_watched(x: any, k: any): any { try { const r = x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_copyWithin_prototype_watched", "Array", "copyWithin", false, uArray_copyWithin_prototype_watched]);
function uArray_copyWithin_round_plain(x: any, k: any): any { const r = x.copyWithin(addAndDelete(x, 0), 1); return [r]; }
table.push(["uArray_copyWithin_round_plain", "Array", "copyWithin", false, uArray_copyWithin_round_plain]);
function uArray_copyWithin_round_tail(x: any, k: any): any { return x.copyWithin(addAndDelete(x, 0), 1); }
table.push(["uArray_copyWithin_round_tail", "Array", "copyWithin", false, uArray_copyWithin_round_tail]);
function uArray_copyWithin_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(addAndDelete(x, 0), 1); return [r]; }
table.push(["uArray_copyWithin_round_loop", "Array", "copyWithin", false, uArray_copyWithin_round_loop]);
function uArray_copyWithin_round_watched(x: any, k: any): any { try { const r = x.copyWithin(addAndDelete(x, 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_copyWithin_round_watched", "Array", "copyWithin", false, uArray_copyWithin_round_watched]);
function uArray_copyWithin_conditional_plain(x: any, k: any): any { const r = x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["uArray_copyWithin_conditional_plain", "Array", "copyWithin", false, uArray_copyWithin_conditional_plain]);
function uArray_copyWithin_conditional_tail(x: any, k: any): any { return x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); }
table.push(["uArray_copyWithin_conditional_tail", "Array", "copyWithin", false, uArray_copyWithin_conditional_tail]);
function uArray_copyWithin_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["uArray_copyWithin_conditional_loop", "Array", "copyWithin", false, uArray_copyWithin_conditional_loop]);
function uArray_copyWithin_conditional_watched(x: any, k: any): any { try { const r = x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_copyWithin_conditional_watched", "Array", "copyWithin", false, uArray_copyWithin_conditional_watched]);
function uArray_copyWithin_throws_plain(x: any, k: any): any { const r = x.copyWithin(fail(0), 1); return [r]; }
table.push(["uArray_copyWithin_throws_plain", "Array", "copyWithin", false, uArray_copyWithin_throws_plain]);
function uArray_copyWithin_throws_tail(x: any, k: any): any { return x.copyWithin(fail(0), 1); }
table.push(["uArray_copyWithin_throws_tail", "Array", "copyWithin", false, uArray_copyWithin_throws_tail]);
function uArray_copyWithin_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(fail(0), 1); return [r]; }
table.push(["uArray_copyWithin_throws_loop", "Array", "copyWithin", false, uArray_copyWithin_throws_loop]);
function uArray_copyWithin_throws_watched(x: any, k: any): any { try { const r = x.copyWithin(fail(0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["uArray_copyWithin_throws_watched", "Array", "copyWithin", false, uArray_copyWithin_throws_watched]);
function uString_slice_call_plain(x: any, k: any): any { const r = x.slice(note("argument", 1)); return [r]; }
table.push(["uString_slice_call_plain", "String", "slice", false, uString_slice_call_plain]);
function uString_slice_call_tail(x: any, k: any): any { return x.slice(note("argument", 1)); }
table.push(["uString_slice_call_tail", "String", "slice", false, uString_slice_call_tail]);
function uString_slice_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(note("argument", 1)); return [r]; }
table.push(["uString_slice_call_loop", "String", "slice", false, uString_slice_call_loop]);
function uString_slice_call_watched(x: any, k: any): any { try { const r = x.slice(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_slice_call_watched", "String", "slice", false, uString_slice_call_watched]);
function uString_slice_getter_plain(x: any, k: any): any { const r = x.slice(holder(1).value); return [r]; }
table.push(["uString_slice_getter_plain", "String", "slice", false, uString_slice_getter_plain]);
function uString_slice_getter_tail(x: any, k: any): any { return x.slice(holder(1).value); }
table.push(["uString_slice_getter_tail", "String", "slice", false, uString_slice_getter_tail]);
function uString_slice_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(holder(1).value); return [r]; }
table.push(["uString_slice_getter_loop", "String", "slice", false, uString_slice_getter_loop]);
function uString_slice_getter_watched(x: any, k: any): any { try { const r = x.slice(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_slice_getter_watched", "String", "slice", false, uString_slice_getter_watched]);
function uString_slice_own_plain(x: any, k: any): any { const r = x.slice(alterOwn(x, "slice", 1)); return [r]; }
table.push(["uString_slice_own_plain", "String", "slice", false, uString_slice_own_plain]);
function uString_slice_own_tail(x: any, k: any): any { return x.slice(alterOwn(x, "slice", 1)); }
table.push(["uString_slice_own_tail", "String", "slice", false, uString_slice_own_tail]);
function uString_slice_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(alterOwn(x, "slice", 1)); return [r]; }
table.push(["uString_slice_own_loop", "String", "slice", false, uString_slice_own_loop]);
function uString_slice_own_watched(x: any, k: any): any { try { const r = x.slice(alterOwn(x, "slice", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_slice_own_watched", "String", "slice", false, uString_slice_own_watched]);
function uString_slice_prototype_plain(x: any, k: any): any { const r = x.slice(alterPrototype(x, "slice", 1)); return [r]; }
table.push(["uString_slice_prototype_plain", "String", "slice", false, uString_slice_prototype_plain]);
function uString_slice_prototype_tail(x: any, k: any): any { return x.slice(alterPrototype(x, "slice", 1)); }
table.push(["uString_slice_prototype_tail", "String", "slice", false, uString_slice_prototype_tail]);
function uString_slice_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(alterPrototype(x, "slice", 1)); return [r]; }
table.push(["uString_slice_prototype_loop", "String", "slice", false, uString_slice_prototype_loop]);
function uString_slice_prototype_watched(x: any, k: any): any { try { const r = x.slice(alterPrototype(x, "slice", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_slice_prototype_watched", "String", "slice", false, uString_slice_prototype_watched]);
function uString_slice_round_plain(x: any, k: any): any { const r = x.slice(addAndDelete(x, 1)); return [r]; }
table.push(["uString_slice_round_plain", "String", "slice", false, uString_slice_round_plain]);
function uString_slice_round_tail(x: any, k: any): any { return x.slice(addAndDelete(x, 1)); }
table.push(["uString_slice_round_tail", "String", "slice", false, uString_slice_round_tail]);
function uString_slice_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(addAndDelete(x, 1)); return [r]; }
table.push(["uString_slice_round_loop", "String", "slice", false, uString_slice_round_loop]);
function uString_slice_round_watched(x: any, k: any): any { try { const r = x.slice(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_slice_round_watched", "String", "slice", false, uString_slice_round_watched]);
function uString_slice_conditional_plain(x: any, k: any): any { const r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_slice_conditional_plain", "String", "slice", false, uString_slice_conditional_plain]);
function uString_slice_conditional_tail(x: any, k: any): any { return x.slice((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uString_slice_conditional_tail", "String", "slice", false, uString_slice_conditional_tail]);
function uString_slice_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_slice_conditional_loop", "String", "slice", false, uString_slice_conditional_loop]);
function uString_slice_conditional_watched(x: any, k: any): any { try { const r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_slice_conditional_watched", "String", "slice", false, uString_slice_conditional_watched]);
function uString_slice_throws_plain(x: any, k: any): any { const r = x.slice(fail(1)); return [r]; }
table.push(["uString_slice_throws_plain", "String", "slice", false, uString_slice_throws_plain]);
function uString_slice_throws_tail(x: any, k: any): any { return x.slice(fail(1)); }
table.push(["uString_slice_throws_tail", "String", "slice", false, uString_slice_throws_tail]);
function uString_slice_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(fail(1)); return [r]; }
table.push(["uString_slice_throws_loop", "String", "slice", false, uString_slice_throws_loop]);
function uString_slice_throws_watched(x: any, k: any): any { try { const r = x.slice(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_slice_throws_watched", "String", "slice", false, uString_slice_throws_watched]);
function uString_indexOf_call_plain(x: any, k: any): any { const r = x.indexOf(note("argument", "b")); return [r]; }
table.push(["uString_indexOf_call_plain", "String", "indexOf", false, uString_indexOf_call_plain]);
function uString_indexOf_call_tail(x: any, k: any): any { return x.indexOf(note("argument", "b")); }
table.push(["uString_indexOf_call_tail", "String", "indexOf", false, uString_indexOf_call_tail]);
function uString_indexOf_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(note("argument", "b")); return [r]; }
table.push(["uString_indexOf_call_loop", "String", "indexOf", false, uString_indexOf_call_loop]);
function uString_indexOf_call_watched(x: any, k: any): any { try { const r = x.indexOf(note("argument", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_indexOf_call_watched", "String", "indexOf", false, uString_indexOf_call_watched]);
function uString_indexOf_getter_plain(x: any, k: any): any { const r = x.indexOf(holder("b").value); return [r]; }
table.push(["uString_indexOf_getter_plain", "String", "indexOf", false, uString_indexOf_getter_plain]);
function uString_indexOf_getter_tail(x: any, k: any): any { return x.indexOf(holder("b").value); }
table.push(["uString_indexOf_getter_tail", "String", "indexOf", false, uString_indexOf_getter_tail]);
function uString_indexOf_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(holder("b").value); return [r]; }
table.push(["uString_indexOf_getter_loop", "String", "indexOf", false, uString_indexOf_getter_loop]);
function uString_indexOf_getter_watched(x: any, k: any): any { try { const r = x.indexOf(holder("b").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_indexOf_getter_watched", "String", "indexOf", false, uString_indexOf_getter_watched]);
function uString_indexOf_own_plain(x: any, k: any): any { const r = x.indexOf(alterOwn(x, "indexOf", "b")); return [r]; }
table.push(["uString_indexOf_own_plain", "String", "indexOf", false, uString_indexOf_own_plain]);
function uString_indexOf_own_tail(x: any, k: any): any { return x.indexOf(alterOwn(x, "indexOf", "b")); }
table.push(["uString_indexOf_own_tail", "String", "indexOf", false, uString_indexOf_own_tail]);
function uString_indexOf_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(alterOwn(x, "indexOf", "b")); return [r]; }
table.push(["uString_indexOf_own_loop", "String", "indexOf", false, uString_indexOf_own_loop]);
function uString_indexOf_own_watched(x: any, k: any): any { try { const r = x.indexOf(alterOwn(x, "indexOf", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_indexOf_own_watched", "String", "indexOf", false, uString_indexOf_own_watched]);
function uString_indexOf_prototype_plain(x: any, k: any): any { const r = x.indexOf(alterPrototype(x, "indexOf", "b")); return [r]; }
table.push(["uString_indexOf_prototype_plain", "String", "indexOf", false, uString_indexOf_prototype_plain]);
function uString_indexOf_prototype_tail(x: any, k: any): any { return x.indexOf(alterPrototype(x, "indexOf", "b")); }
table.push(["uString_indexOf_prototype_tail", "String", "indexOf", false, uString_indexOf_prototype_tail]);
function uString_indexOf_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(alterPrototype(x, "indexOf", "b")); return [r]; }
table.push(["uString_indexOf_prototype_loop", "String", "indexOf", false, uString_indexOf_prototype_loop]);
function uString_indexOf_prototype_watched(x: any, k: any): any { try { const r = x.indexOf(alterPrototype(x, "indexOf", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_indexOf_prototype_watched", "String", "indexOf", false, uString_indexOf_prototype_watched]);
function uString_indexOf_round_plain(x: any, k: any): any { const r = x.indexOf(addAndDelete(x, "b")); return [r]; }
table.push(["uString_indexOf_round_plain", "String", "indexOf", false, uString_indexOf_round_plain]);
function uString_indexOf_round_tail(x: any, k: any): any { return x.indexOf(addAndDelete(x, "b")); }
table.push(["uString_indexOf_round_tail", "String", "indexOf", false, uString_indexOf_round_tail]);
function uString_indexOf_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(addAndDelete(x, "b")); return [r]; }
table.push(["uString_indexOf_round_loop", "String", "indexOf", false, uString_indexOf_round_loop]);
function uString_indexOf_round_watched(x: any, k: any): any { try { const r = x.indexOf(addAndDelete(x, "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_indexOf_round_watched", "String", "indexOf", false, uString_indexOf_round_watched]);
function uString_indexOf_conditional_plain(x: any, k: any): any { const r = x.indexOf((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_indexOf_conditional_plain", "String", "indexOf", false, uString_indexOf_conditional_plain]);
function uString_indexOf_conditional_tail(x: any, k: any): any { return x.indexOf((k ? note("yes", "b") : note("no", undefined))); }
table.push(["uString_indexOf_conditional_tail", "String", "indexOf", false, uString_indexOf_conditional_tail]);
function uString_indexOf_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_indexOf_conditional_loop", "String", "indexOf", false, uString_indexOf_conditional_loop]);
function uString_indexOf_conditional_watched(x: any, k: any): any { try { const r = x.indexOf((k ? note("yes", "b") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_indexOf_conditional_watched", "String", "indexOf", false, uString_indexOf_conditional_watched]);
function uString_indexOf_throws_plain(x: any, k: any): any { const r = x.indexOf(fail("b")); return [r]; }
table.push(["uString_indexOf_throws_plain", "String", "indexOf", false, uString_indexOf_throws_plain]);
function uString_indexOf_throws_tail(x: any, k: any): any { return x.indexOf(fail("b")); }
table.push(["uString_indexOf_throws_tail", "String", "indexOf", false, uString_indexOf_throws_tail]);
function uString_indexOf_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(fail("b")); return [r]; }
table.push(["uString_indexOf_throws_loop", "String", "indexOf", false, uString_indexOf_throws_loop]);
function uString_indexOf_throws_watched(x: any, k: any): any { try { const r = x.indexOf(fail("b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_indexOf_throws_watched", "String", "indexOf", false, uString_indexOf_throws_watched]);
function uString_startsWith_call_plain(x: any, k: any): any { const r = x.startsWith(note("argument", "a")); return [r]; }
table.push(["uString_startsWith_call_plain", "String", "startsWith", false, uString_startsWith_call_plain]);
function uString_startsWith_call_tail(x: any, k: any): any { return x.startsWith(note("argument", "a")); }
table.push(["uString_startsWith_call_tail", "String", "startsWith", false, uString_startsWith_call_tail]);
function uString_startsWith_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.startsWith(note("argument", "a")); return [r]; }
table.push(["uString_startsWith_call_loop", "String", "startsWith", false, uString_startsWith_call_loop]);
function uString_startsWith_call_watched(x: any, k: any): any { try { const r = x.startsWith(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_startsWith_call_watched", "String", "startsWith", false, uString_startsWith_call_watched]);
function uString_startsWith_getter_plain(x: any, k: any): any { const r = x.startsWith(holder("a").value); return [r]; }
table.push(["uString_startsWith_getter_plain", "String", "startsWith", false, uString_startsWith_getter_plain]);
function uString_startsWith_getter_tail(x: any, k: any): any { return x.startsWith(holder("a").value); }
table.push(["uString_startsWith_getter_tail", "String", "startsWith", false, uString_startsWith_getter_tail]);
function uString_startsWith_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.startsWith(holder("a").value); return [r]; }
table.push(["uString_startsWith_getter_loop", "String", "startsWith", false, uString_startsWith_getter_loop]);
function uString_startsWith_getter_watched(x: any, k: any): any { try { const r = x.startsWith(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_startsWith_getter_watched", "String", "startsWith", false, uString_startsWith_getter_watched]);
function uString_startsWith_own_plain(x: any, k: any): any { const r = x.startsWith(alterOwn(x, "startsWith", "a")); return [r]; }
table.push(["uString_startsWith_own_plain", "String", "startsWith", false, uString_startsWith_own_plain]);
function uString_startsWith_own_tail(x: any, k: any): any { return x.startsWith(alterOwn(x, "startsWith", "a")); }
table.push(["uString_startsWith_own_tail", "String", "startsWith", false, uString_startsWith_own_tail]);
function uString_startsWith_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.startsWith(alterOwn(x, "startsWith", "a")); return [r]; }
table.push(["uString_startsWith_own_loop", "String", "startsWith", false, uString_startsWith_own_loop]);
function uString_startsWith_own_watched(x: any, k: any): any { try { const r = x.startsWith(alterOwn(x, "startsWith", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_startsWith_own_watched", "String", "startsWith", false, uString_startsWith_own_watched]);
function uString_startsWith_prototype_plain(x: any, k: any): any { const r = x.startsWith(alterPrototype(x, "startsWith", "a")); return [r]; }
table.push(["uString_startsWith_prototype_plain", "String", "startsWith", false, uString_startsWith_prototype_plain]);
function uString_startsWith_prototype_tail(x: any, k: any): any { return x.startsWith(alterPrototype(x, "startsWith", "a")); }
table.push(["uString_startsWith_prototype_tail", "String", "startsWith", false, uString_startsWith_prototype_tail]);
function uString_startsWith_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.startsWith(alterPrototype(x, "startsWith", "a")); return [r]; }
table.push(["uString_startsWith_prototype_loop", "String", "startsWith", false, uString_startsWith_prototype_loop]);
function uString_startsWith_prototype_watched(x: any, k: any): any { try { const r = x.startsWith(alterPrototype(x, "startsWith", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_startsWith_prototype_watched", "String", "startsWith", false, uString_startsWith_prototype_watched]);
function uString_startsWith_round_plain(x: any, k: any): any { const r = x.startsWith(addAndDelete(x, "a")); return [r]; }
table.push(["uString_startsWith_round_plain", "String", "startsWith", false, uString_startsWith_round_plain]);
function uString_startsWith_round_tail(x: any, k: any): any { return x.startsWith(addAndDelete(x, "a")); }
table.push(["uString_startsWith_round_tail", "String", "startsWith", false, uString_startsWith_round_tail]);
function uString_startsWith_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.startsWith(addAndDelete(x, "a")); return [r]; }
table.push(["uString_startsWith_round_loop", "String", "startsWith", false, uString_startsWith_round_loop]);
function uString_startsWith_round_watched(x: any, k: any): any { try { const r = x.startsWith(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_startsWith_round_watched", "String", "startsWith", false, uString_startsWith_round_watched]);
function uString_startsWith_conditional_plain(x: any, k: any): any { const r = x.startsWith((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uString_startsWith_conditional_plain", "String", "startsWith", false, uString_startsWith_conditional_plain]);
function uString_startsWith_conditional_tail(x: any, k: any): any { return x.startsWith((k ? note("yes", "a") : note("no", undefined))); }
table.push(["uString_startsWith_conditional_tail", "String", "startsWith", false, uString_startsWith_conditional_tail]);
function uString_startsWith_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.startsWith((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uString_startsWith_conditional_loop", "String", "startsWith", false, uString_startsWith_conditional_loop]);
function uString_startsWith_conditional_watched(x: any, k: any): any { try { const r = x.startsWith((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_startsWith_conditional_watched", "String", "startsWith", false, uString_startsWith_conditional_watched]);
function uString_startsWith_throws_plain(x: any, k: any): any { const r = x.startsWith(fail("a")); return [r]; }
table.push(["uString_startsWith_throws_plain", "String", "startsWith", false, uString_startsWith_throws_plain]);
function uString_startsWith_throws_tail(x: any, k: any): any { return x.startsWith(fail("a")); }
table.push(["uString_startsWith_throws_tail", "String", "startsWith", false, uString_startsWith_throws_tail]);
function uString_startsWith_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.startsWith(fail("a")); return [r]; }
table.push(["uString_startsWith_throws_loop", "String", "startsWith", false, uString_startsWith_throws_loop]);
function uString_startsWith_throws_watched(x: any, k: any): any { try { const r = x.startsWith(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_startsWith_throws_watched", "String", "startsWith", false, uString_startsWith_throws_watched]);
function uString_endsWith_call_plain(x: any, k: any): any { const r = x.endsWith(note("argument", "c")); return [r]; }
table.push(["uString_endsWith_call_plain", "String", "endsWith", false, uString_endsWith_call_plain]);
function uString_endsWith_call_tail(x: any, k: any): any { return x.endsWith(note("argument", "c")); }
table.push(["uString_endsWith_call_tail", "String", "endsWith", false, uString_endsWith_call_tail]);
function uString_endsWith_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.endsWith(note("argument", "c")); return [r]; }
table.push(["uString_endsWith_call_loop", "String", "endsWith", false, uString_endsWith_call_loop]);
function uString_endsWith_call_watched(x: any, k: any): any { try { const r = x.endsWith(note("argument", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_endsWith_call_watched", "String", "endsWith", false, uString_endsWith_call_watched]);
function uString_endsWith_getter_plain(x: any, k: any): any { const r = x.endsWith(holder("c").value); return [r]; }
table.push(["uString_endsWith_getter_plain", "String", "endsWith", false, uString_endsWith_getter_plain]);
function uString_endsWith_getter_tail(x: any, k: any): any { return x.endsWith(holder("c").value); }
table.push(["uString_endsWith_getter_tail", "String", "endsWith", false, uString_endsWith_getter_tail]);
function uString_endsWith_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.endsWith(holder("c").value); return [r]; }
table.push(["uString_endsWith_getter_loop", "String", "endsWith", false, uString_endsWith_getter_loop]);
function uString_endsWith_getter_watched(x: any, k: any): any { try { const r = x.endsWith(holder("c").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_endsWith_getter_watched", "String", "endsWith", false, uString_endsWith_getter_watched]);
function uString_endsWith_own_plain(x: any, k: any): any { const r = x.endsWith(alterOwn(x, "endsWith", "c")); return [r]; }
table.push(["uString_endsWith_own_plain", "String", "endsWith", false, uString_endsWith_own_plain]);
function uString_endsWith_own_tail(x: any, k: any): any { return x.endsWith(alterOwn(x, "endsWith", "c")); }
table.push(["uString_endsWith_own_tail", "String", "endsWith", false, uString_endsWith_own_tail]);
function uString_endsWith_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.endsWith(alterOwn(x, "endsWith", "c")); return [r]; }
table.push(["uString_endsWith_own_loop", "String", "endsWith", false, uString_endsWith_own_loop]);
function uString_endsWith_own_watched(x: any, k: any): any { try { const r = x.endsWith(alterOwn(x, "endsWith", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_endsWith_own_watched", "String", "endsWith", false, uString_endsWith_own_watched]);
function uString_endsWith_prototype_plain(x: any, k: any): any { const r = x.endsWith(alterPrototype(x, "endsWith", "c")); return [r]; }
table.push(["uString_endsWith_prototype_plain", "String", "endsWith", false, uString_endsWith_prototype_plain]);
function uString_endsWith_prototype_tail(x: any, k: any): any { return x.endsWith(alterPrototype(x, "endsWith", "c")); }
table.push(["uString_endsWith_prototype_tail", "String", "endsWith", false, uString_endsWith_prototype_tail]);
function uString_endsWith_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.endsWith(alterPrototype(x, "endsWith", "c")); return [r]; }
table.push(["uString_endsWith_prototype_loop", "String", "endsWith", false, uString_endsWith_prototype_loop]);
function uString_endsWith_prototype_watched(x: any, k: any): any { try { const r = x.endsWith(alterPrototype(x, "endsWith", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_endsWith_prototype_watched", "String", "endsWith", false, uString_endsWith_prototype_watched]);
function uString_endsWith_round_plain(x: any, k: any): any { const r = x.endsWith(addAndDelete(x, "c")); return [r]; }
table.push(["uString_endsWith_round_plain", "String", "endsWith", false, uString_endsWith_round_plain]);
function uString_endsWith_round_tail(x: any, k: any): any { return x.endsWith(addAndDelete(x, "c")); }
table.push(["uString_endsWith_round_tail", "String", "endsWith", false, uString_endsWith_round_tail]);
function uString_endsWith_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.endsWith(addAndDelete(x, "c")); return [r]; }
table.push(["uString_endsWith_round_loop", "String", "endsWith", false, uString_endsWith_round_loop]);
function uString_endsWith_round_watched(x: any, k: any): any { try { const r = x.endsWith(addAndDelete(x, "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_endsWith_round_watched", "String", "endsWith", false, uString_endsWith_round_watched]);
function uString_endsWith_conditional_plain(x: any, k: any): any { const r = x.endsWith((k ? note("yes", "c") : note("no", undefined))); return [r]; }
table.push(["uString_endsWith_conditional_plain", "String", "endsWith", false, uString_endsWith_conditional_plain]);
function uString_endsWith_conditional_tail(x: any, k: any): any { return x.endsWith((k ? note("yes", "c") : note("no", undefined))); }
table.push(["uString_endsWith_conditional_tail", "String", "endsWith", false, uString_endsWith_conditional_tail]);
function uString_endsWith_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.endsWith((k ? note("yes", "c") : note("no", undefined))); return [r]; }
table.push(["uString_endsWith_conditional_loop", "String", "endsWith", false, uString_endsWith_conditional_loop]);
function uString_endsWith_conditional_watched(x: any, k: any): any { try { const r = x.endsWith((k ? note("yes", "c") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_endsWith_conditional_watched", "String", "endsWith", false, uString_endsWith_conditional_watched]);
function uString_endsWith_throws_plain(x: any, k: any): any { const r = x.endsWith(fail("c")); return [r]; }
table.push(["uString_endsWith_throws_plain", "String", "endsWith", false, uString_endsWith_throws_plain]);
function uString_endsWith_throws_tail(x: any, k: any): any { return x.endsWith(fail("c")); }
table.push(["uString_endsWith_throws_tail", "String", "endsWith", false, uString_endsWith_throws_tail]);
function uString_endsWith_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.endsWith(fail("c")); return [r]; }
table.push(["uString_endsWith_throws_loop", "String", "endsWith", false, uString_endsWith_throws_loop]);
function uString_endsWith_throws_watched(x: any, k: any): any { try { const r = x.endsWith(fail("c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_endsWith_throws_watched", "String", "endsWith", false, uString_endsWith_throws_watched]);
function uString_includes_call_plain(x: any, k: any): any { const r = x.includes(note("argument", "b")); return [r]; }
table.push(["uString_includes_call_plain", "String", "includes", false, uString_includes_call_plain]);
function uString_includes_call_tail(x: any, k: any): any { return x.includes(note("argument", "b")); }
table.push(["uString_includes_call_tail", "String", "includes", false, uString_includes_call_tail]);
function uString_includes_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(note("argument", "b")); return [r]; }
table.push(["uString_includes_call_loop", "String", "includes", false, uString_includes_call_loop]);
function uString_includes_call_watched(x: any, k: any): any { try { const r = x.includes(note("argument", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_includes_call_watched", "String", "includes", false, uString_includes_call_watched]);
function uString_includes_getter_plain(x: any, k: any): any { const r = x.includes(holder("b").value); return [r]; }
table.push(["uString_includes_getter_plain", "String", "includes", false, uString_includes_getter_plain]);
function uString_includes_getter_tail(x: any, k: any): any { return x.includes(holder("b").value); }
table.push(["uString_includes_getter_tail", "String", "includes", false, uString_includes_getter_tail]);
function uString_includes_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(holder("b").value); return [r]; }
table.push(["uString_includes_getter_loop", "String", "includes", false, uString_includes_getter_loop]);
function uString_includes_getter_watched(x: any, k: any): any { try { const r = x.includes(holder("b").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_includes_getter_watched", "String", "includes", false, uString_includes_getter_watched]);
function uString_includes_own_plain(x: any, k: any): any { const r = x.includes(alterOwn(x, "includes", "b")); return [r]; }
table.push(["uString_includes_own_plain", "String", "includes", false, uString_includes_own_plain]);
function uString_includes_own_tail(x: any, k: any): any { return x.includes(alterOwn(x, "includes", "b")); }
table.push(["uString_includes_own_tail", "String", "includes", false, uString_includes_own_tail]);
function uString_includes_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(alterOwn(x, "includes", "b")); return [r]; }
table.push(["uString_includes_own_loop", "String", "includes", false, uString_includes_own_loop]);
function uString_includes_own_watched(x: any, k: any): any { try { const r = x.includes(alterOwn(x, "includes", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_includes_own_watched", "String", "includes", false, uString_includes_own_watched]);
function uString_includes_prototype_plain(x: any, k: any): any { const r = x.includes(alterPrototype(x, "includes", "b")); return [r]; }
table.push(["uString_includes_prototype_plain", "String", "includes", false, uString_includes_prototype_plain]);
function uString_includes_prototype_tail(x: any, k: any): any { return x.includes(alterPrototype(x, "includes", "b")); }
table.push(["uString_includes_prototype_tail", "String", "includes", false, uString_includes_prototype_tail]);
function uString_includes_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(alterPrototype(x, "includes", "b")); return [r]; }
table.push(["uString_includes_prototype_loop", "String", "includes", false, uString_includes_prototype_loop]);
function uString_includes_prototype_watched(x: any, k: any): any { try { const r = x.includes(alterPrototype(x, "includes", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_includes_prototype_watched", "String", "includes", false, uString_includes_prototype_watched]);
function uString_includes_round_plain(x: any, k: any): any { const r = x.includes(addAndDelete(x, "b")); return [r]; }
table.push(["uString_includes_round_plain", "String", "includes", false, uString_includes_round_plain]);
function uString_includes_round_tail(x: any, k: any): any { return x.includes(addAndDelete(x, "b")); }
table.push(["uString_includes_round_tail", "String", "includes", false, uString_includes_round_tail]);
function uString_includes_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(addAndDelete(x, "b")); return [r]; }
table.push(["uString_includes_round_loop", "String", "includes", false, uString_includes_round_loop]);
function uString_includes_round_watched(x: any, k: any): any { try { const r = x.includes(addAndDelete(x, "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_includes_round_watched", "String", "includes", false, uString_includes_round_watched]);
function uString_includes_conditional_plain(x: any, k: any): any { const r = x.includes((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_includes_conditional_plain", "String", "includes", false, uString_includes_conditional_plain]);
function uString_includes_conditional_tail(x: any, k: any): any { return x.includes((k ? note("yes", "b") : note("no", undefined))); }
table.push(["uString_includes_conditional_tail", "String", "includes", false, uString_includes_conditional_tail]);
function uString_includes_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_includes_conditional_loop", "String", "includes", false, uString_includes_conditional_loop]);
function uString_includes_conditional_watched(x: any, k: any): any { try { const r = x.includes((k ? note("yes", "b") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_includes_conditional_watched", "String", "includes", false, uString_includes_conditional_watched]);
function uString_includes_throws_plain(x: any, k: any): any { const r = x.includes(fail("b")); return [r]; }
table.push(["uString_includes_throws_plain", "String", "includes", false, uString_includes_throws_plain]);
function uString_includes_throws_tail(x: any, k: any): any { return x.includes(fail("b")); }
table.push(["uString_includes_throws_tail", "String", "includes", false, uString_includes_throws_tail]);
function uString_includes_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(fail("b")); return [r]; }
table.push(["uString_includes_throws_loop", "String", "includes", false, uString_includes_throws_loop]);
function uString_includes_throws_watched(x: any, k: any): any { try { const r = x.includes(fail("b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_includes_throws_watched", "String", "includes", false, uString_includes_throws_watched]);
function uString_padStart_call_plain(x: any, k: any): any { const r = x.padStart(note("argument", 8), "*"); return [r]; }
table.push(["uString_padStart_call_plain", "String", "padStart", false, uString_padStart_call_plain]);
function uString_padStart_call_tail(x: any, k: any): any { return x.padStart(note("argument", 8), "*"); }
table.push(["uString_padStart_call_tail", "String", "padStart", false, uString_padStart_call_tail]);
function uString_padStart_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.padStart(note("argument", 8), "*"); return [r]; }
table.push(["uString_padStart_call_loop", "String", "padStart", false, uString_padStart_call_loop]);
function uString_padStart_call_watched(x: any, k: any): any { try { const r = x.padStart(note("argument", 8), "*"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_padStart_call_watched", "String", "padStart", false, uString_padStart_call_watched]);
function uString_padStart_getter_plain(x: any, k: any): any { const r = x.padStart(holder(8).value, "*"); return [r]; }
table.push(["uString_padStart_getter_plain", "String", "padStart", false, uString_padStart_getter_plain]);
function uString_padStart_getter_tail(x: any, k: any): any { return x.padStart(holder(8).value, "*"); }
table.push(["uString_padStart_getter_tail", "String", "padStart", false, uString_padStart_getter_tail]);
function uString_padStart_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.padStart(holder(8).value, "*"); return [r]; }
table.push(["uString_padStart_getter_loop", "String", "padStart", false, uString_padStart_getter_loop]);
function uString_padStart_getter_watched(x: any, k: any): any { try { const r = x.padStart(holder(8).value, "*"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_padStart_getter_watched", "String", "padStart", false, uString_padStart_getter_watched]);
function uString_padStart_own_plain(x: any, k: any): any { const r = x.padStart(alterOwn(x, "padStart", 8), "*"); return [r]; }
table.push(["uString_padStart_own_plain", "String", "padStart", false, uString_padStart_own_plain]);
function uString_padStart_own_tail(x: any, k: any): any { return x.padStart(alterOwn(x, "padStart", 8), "*"); }
table.push(["uString_padStart_own_tail", "String", "padStart", false, uString_padStart_own_tail]);
function uString_padStart_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.padStart(alterOwn(x, "padStart", 8), "*"); return [r]; }
table.push(["uString_padStart_own_loop", "String", "padStart", false, uString_padStart_own_loop]);
function uString_padStart_own_watched(x: any, k: any): any { try { const r = x.padStart(alterOwn(x, "padStart", 8), "*"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_padStart_own_watched", "String", "padStart", false, uString_padStart_own_watched]);
function uString_padStart_prototype_plain(x: any, k: any): any { const r = x.padStart(alterPrototype(x, "padStart", 8), "*"); return [r]; }
table.push(["uString_padStart_prototype_plain", "String", "padStart", false, uString_padStart_prototype_plain]);
function uString_padStart_prototype_tail(x: any, k: any): any { return x.padStart(alterPrototype(x, "padStart", 8), "*"); }
table.push(["uString_padStart_prototype_tail", "String", "padStart", false, uString_padStart_prototype_tail]);
function uString_padStart_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.padStart(alterPrototype(x, "padStart", 8), "*"); return [r]; }
table.push(["uString_padStart_prototype_loop", "String", "padStart", false, uString_padStart_prototype_loop]);
function uString_padStart_prototype_watched(x: any, k: any): any { try { const r = x.padStart(alterPrototype(x, "padStart", 8), "*"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_padStart_prototype_watched", "String", "padStart", false, uString_padStart_prototype_watched]);
function uString_padStart_round_plain(x: any, k: any): any { const r = x.padStart(addAndDelete(x, 8), "*"); return [r]; }
table.push(["uString_padStart_round_plain", "String", "padStart", false, uString_padStart_round_plain]);
function uString_padStart_round_tail(x: any, k: any): any { return x.padStart(addAndDelete(x, 8), "*"); }
table.push(["uString_padStart_round_tail", "String", "padStart", false, uString_padStart_round_tail]);
function uString_padStart_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.padStart(addAndDelete(x, 8), "*"); return [r]; }
table.push(["uString_padStart_round_loop", "String", "padStart", false, uString_padStart_round_loop]);
function uString_padStart_round_watched(x: any, k: any): any { try { const r = x.padStart(addAndDelete(x, 8), "*"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_padStart_round_watched", "String", "padStart", false, uString_padStart_round_watched]);
function uString_padStart_conditional_plain(x: any, k: any): any { const r = x.padStart((k ? note("yes", 8) : note("no", undefined)), "*"); return [r]; }
table.push(["uString_padStart_conditional_plain", "String", "padStart", false, uString_padStart_conditional_plain]);
function uString_padStart_conditional_tail(x: any, k: any): any { return x.padStart((k ? note("yes", 8) : note("no", undefined)), "*"); }
table.push(["uString_padStart_conditional_tail", "String", "padStart", false, uString_padStart_conditional_tail]);
function uString_padStart_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.padStart((k ? note("yes", 8) : note("no", undefined)), "*"); return [r]; }
table.push(["uString_padStart_conditional_loop", "String", "padStart", false, uString_padStart_conditional_loop]);
function uString_padStart_conditional_watched(x: any, k: any): any { try { const r = x.padStart((k ? note("yes", 8) : note("no", undefined)), "*"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_padStart_conditional_watched", "String", "padStart", false, uString_padStart_conditional_watched]);
function uString_padStart_throws_plain(x: any, k: any): any { const r = x.padStart(fail(8), "*"); return [r]; }
table.push(["uString_padStart_throws_plain", "String", "padStart", false, uString_padStart_throws_plain]);
function uString_padStart_throws_tail(x: any, k: any): any { return x.padStart(fail(8), "*"); }
table.push(["uString_padStart_throws_tail", "String", "padStart", false, uString_padStart_throws_tail]);
function uString_padStart_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.padStart(fail(8), "*"); return [r]; }
table.push(["uString_padStart_throws_loop", "String", "padStart", false, uString_padStart_throws_loop]);
function uString_padStart_throws_watched(x: any, k: any): any { try { const r = x.padStart(fail(8), "*"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_padStart_throws_watched", "String", "padStart", false, uString_padStart_throws_watched]);
function uString_replace_call_plain(x: any, k: any): any { const r = x.replace(note("argument", "b"), "x"); return [r]; }
table.push(["uString_replace_call_plain", "String", "replace", false, uString_replace_call_plain]);
function uString_replace_call_tail(x: any, k: any): any { return x.replace(note("argument", "b"), "x"); }
table.push(["uString_replace_call_tail", "String", "replace", false, uString_replace_call_tail]);
function uString_replace_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replace(note("argument", "b"), "x"); return [r]; }
table.push(["uString_replace_call_loop", "String", "replace", false, uString_replace_call_loop]);
function uString_replace_call_watched(x: any, k: any): any { try { const r = x.replace(note("argument", "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replace_call_watched", "String", "replace", false, uString_replace_call_watched]);
function uString_replace_getter_plain(x: any, k: any): any { const r = x.replace(holder("b").value, "x"); return [r]; }
table.push(["uString_replace_getter_plain", "String", "replace", false, uString_replace_getter_plain]);
function uString_replace_getter_tail(x: any, k: any): any { return x.replace(holder("b").value, "x"); }
table.push(["uString_replace_getter_tail", "String", "replace", false, uString_replace_getter_tail]);
function uString_replace_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replace(holder("b").value, "x"); return [r]; }
table.push(["uString_replace_getter_loop", "String", "replace", false, uString_replace_getter_loop]);
function uString_replace_getter_watched(x: any, k: any): any { try { const r = x.replace(holder("b").value, "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replace_getter_watched", "String", "replace", false, uString_replace_getter_watched]);
function uString_replace_own_plain(x: any, k: any): any { const r = x.replace(alterOwn(x, "replace", "b"), "x"); return [r]; }
table.push(["uString_replace_own_plain", "String", "replace", false, uString_replace_own_plain]);
function uString_replace_own_tail(x: any, k: any): any { return x.replace(alterOwn(x, "replace", "b"), "x"); }
table.push(["uString_replace_own_tail", "String", "replace", false, uString_replace_own_tail]);
function uString_replace_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replace(alterOwn(x, "replace", "b"), "x"); return [r]; }
table.push(["uString_replace_own_loop", "String", "replace", false, uString_replace_own_loop]);
function uString_replace_own_watched(x: any, k: any): any { try { const r = x.replace(alterOwn(x, "replace", "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replace_own_watched", "String", "replace", false, uString_replace_own_watched]);
function uString_replace_prototype_plain(x: any, k: any): any { const r = x.replace(alterPrototype(x, "replace", "b"), "x"); return [r]; }
table.push(["uString_replace_prototype_plain", "String", "replace", false, uString_replace_prototype_plain]);
function uString_replace_prototype_tail(x: any, k: any): any { return x.replace(alterPrototype(x, "replace", "b"), "x"); }
table.push(["uString_replace_prototype_tail", "String", "replace", false, uString_replace_prototype_tail]);
function uString_replace_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replace(alterPrototype(x, "replace", "b"), "x"); return [r]; }
table.push(["uString_replace_prototype_loop", "String", "replace", false, uString_replace_prototype_loop]);
function uString_replace_prototype_watched(x: any, k: any): any { try { const r = x.replace(alterPrototype(x, "replace", "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replace_prototype_watched", "String", "replace", false, uString_replace_prototype_watched]);
function uString_replace_round_plain(x: any, k: any): any { const r = x.replace(addAndDelete(x, "b"), "x"); return [r]; }
table.push(["uString_replace_round_plain", "String", "replace", false, uString_replace_round_plain]);
function uString_replace_round_tail(x: any, k: any): any { return x.replace(addAndDelete(x, "b"), "x"); }
table.push(["uString_replace_round_tail", "String", "replace", false, uString_replace_round_tail]);
function uString_replace_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replace(addAndDelete(x, "b"), "x"); return [r]; }
table.push(["uString_replace_round_loop", "String", "replace", false, uString_replace_round_loop]);
function uString_replace_round_watched(x: any, k: any): any { try { const r = x.replace(addAndDelete(x, "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replace_round_watched", "String", "replace", false, uString_replace_round_watched]);
function uString_replace_conditional_plain(x: any, k: any): any { const r = x.replace((k ? note("yes", "b") : note("no", undefined)), "x"); return [r]; }
table.push(["uString_replace_conditional_plain", "String", "replace", false, uString_replace_conditional_plain]);
function uString_replace_conditional_tail(x: any, k: any): any { return x.replace((k ? note("yes", "b") : note("no", undefined)), "x"); }
table.push(["uString_replace_conditional_tail", "String", "replace", false, uString_replace_conditional_tail]);
function uString_replace_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replace((k ? note("yes", "b") : note("no", undefined)), "x"); return [r]; }
table.push(["uString_replace_conditional_loop", "String", "replace", false, uString_replace_conditional_loop]);
function uString_replace_conditional_watched(x: any, k: any): any { try { const r = x.replace((k ? note("yes", "b") : note("no", undefined)), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replace_conditional_watched", "String", "replace", false, uString_replace_conditional_watched]);
function uString_replace_throws_plain(x: any, k: any): any { const r = x.replace(fail("b"), "x"); return [r]; }
table.push(["uString_replace_throws_plain", "String", "replace", false, uString_replace_throws_plain]);
function uString_replace_throws_tail(x: any, k: any): any { return x.replace(fail("b"), "x"); }
table.push(["uString_replace_throws_tail", "String", "replace", false, uString_replace_throws_tail]);
function uString_replace_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replace(fail("b"), "x"); return [r]; }
table.push(["uString_replace_throws_loop", "String", "replace", false, uString_replace_throws_loop]);
function uString_replace_throws_watched(x: any, k: any): any { try { const r = x.replace(fail("b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replace_throws_watched", "String", "replace", false, uString_replace_throws_watched]);
function uString_split_call_plain(x: any, k: any): any { const r = x.split(note("argument", "b")); return [r]; }
table.push(["uString_split_call_plain", "String", "split", false, uString_split_call_plain]);
function uString_split_call_tail(x: any, k: any): any { return x.split(note("argument", "b")); }
table.push(["uString_split_call_tail", "String", "split", false, uString_split_call_tail]);
function uString_split_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.split(note("argument", "b")); return [r]; }
table.push(["uString_split_call_loop", "String", "split", false, uString_split_call_loop]);
function uString_split_call_watched(x: any, k: any): any { try { const r = x.split(note("argument", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_split_call_watched", "String", "split", false, uString_split_call_watched]);
function uString_split_getter_plain(x: any, k: any): any { const r = x.split(holder("b").value); return [r]; }
table.push(["uString_split_getter_plain", "String", "split", false, uString_split_getter_plain]);
function uString_split_getter_tail(x: any, k: any): any { return x.split(holder("b").value); }
table.push(["uString_split_getter_tail", "String", "split", false, uString_split_getter_tail]);
function uString_split_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.split(holder("b").value); return [r]; }
table.push(["uString_split_getter_loop", "String", "split", false, uString_split_getter_loop]);
function uString_split_getter_watched(x: any, k: any): any { try { const r = x.split(holder("b").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_split_getter_watched", "String", "split", false, uString_split_getter_watched]);
function uString_split_own_plain(x: any, k: any): any { const r = x.split(alterOwn(x, "split", "b")); return [r]; }
table.push(["uString_split_own_plain", "String", "split", false, uString_split_own_plain]);
function uString_split_own_tail(x: any, k: any): any { return x.split(alterOwn(x, "split", "b")); }
table.push(["uString_split_own_tail", "String", "split", false, uString_split_own_tail]);
function uString_split_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.split(alterOwn(x, "split", "b")); return [r]; }
table.push(["uString_split_own_loop", "String", "split", false, uString_split_own_loop]);
function uString_split_own_watched(x: any, k: any): any { try { const r = x.split(alterOwn(x, "split", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_split_own_watched", "String", "split", false, uString_split_own_watched]);
function uString_split_prototype_plain(x: any, k: any): any { const r = x.split(alterPrototype(x, "split", "b")); return [r]; }
table.push(["uString_split_prototype_plain", "String", "split", false, uString_split_prototype_plain]);
function uString_split_prototype_tail(x: any, k: any): any { return x.split(alterPrototype(x, "split", "b")); }
table.push(["uString_split_prototype_tail", "String", "split", false, uString_split_prototype_tail]);
function uString_split_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.split(alterPrototype(x, "split", "b")); return [r]; }
table.push(["uString_split_prototype_loop", "String", "split", false, uString_split_prototype_loop]);
function uString_split_prototype_watched(x: any, k: any): any { try { const r = x.split(alterPrototype(x, "split", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_split_prototype_watched", "String", "split", false, uString_split_prototype_watched]);
function uString_split_round_plain(x: any, k: any): any { const r = x.split(addAndDelete(x, "b")); return [r]; }
table.push(["uString_split_round_plain", "String", "split", false, uString_split_round_plain]);
function uString_split_round_tail(x: any, k: any): any { return x.split(addAndDelete(x, "b")); }
table.push(["uString_split_round_tail", "String", "split", false, uString_split_round_tail]);
function uString_split_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.split(addAndDelete(x, "b")); return [r]; }
table.push(["uString_split_round_loop", "String", "split", false, uString_split_round_loop]);
function uString_split_round_watched(x: any, k: any): any { try { const r = x.split(addAndDelete(x, "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_split_round_watched", "String", "split", false, uString_split_round_watched]);
function uString_split_conditional_plain(x: any, k: any): any { const r = x.split((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_split_conditional_plain", "String", "split", false, uString_split_conditional_plain]);
function uString_split_conditional_tail(x: any, k: any): any { return x.split((k ? note("yes", "b") : note("no", undefined))); }
table.push(["uString_split_conditional_tail", "String", "split", false, uString_split_conditional_tail]);
function uString_split_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.split((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_split_conditional_loop", "String", "split", false, uString_split_conditional_loop]);
function uString_split_conditional_watched(x: any, k: any): any { try { const r = x.split((k ? note("yes", "b") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_split_conditional_watched", "String", "split", false, uString_split_conditional_watched]);
function uString_split_throws_plain(x: any, k: any): any { const r = x.split(fail("b")); return [r]; }
table.push(["uString_split_throws_plain", "String", "split", false, uString_split_throws_plain]);
function uString_split_throws_tail(x: any, k: any): any { return x.split(fail("b")); }
table.push(["uString_split_throws_tail", "String", "split", false, uString_split_throws_tail]);
function uString_split_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.split(fail("b")); return [r]; }
table.push(["uString_split_throws_loop", "String", "split", false, uString_split_throws_loop]);
function uString_split_throws_watched(x: any, k: any): any { try { const r = x.split(fail("b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_split_throws_watched", "String", "split", false, uString_split_throws_watched]);
function uString_charAt_call_plain(x: any, k: any): any { const r = x.charAt(note("argument", 1)); return [r]; }
table.push(["uString_charAt_call_plain", "String", "charAt", false, uString_charAt_call_plain]);
function uString_charAt_call_tail(x: any, k: any): any { return x.charAt(note("argument", 1)); }
table.push(["uString_charAt_call_tail", "String", "charAt", false, uString_charAt_call_tail]);
function uString_charAt_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charAt(note("argument", 1)); return [r]; }
table.push(["uString_charAt_call_loop", "String", "charAt", false, uString_charAt_call_loop]);
function uString_charAt_call_watched(x: any, k: any): any { try { const r = x.charAt(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charAt_call_watched", "String", "charAt", false, uString_charAt_call_watched]);
function uString_charAt_getter_plain(x: any, k: any): any { const r = x.charAt(holder(1).value); return [r]; }
table.push(["uString_charAt_getter_plain", "String", "charAt", false, uString_charAt_getter_plain]);
function uString_charAt_getter_tail(x: any, k: any): any { return x.charAt(holder(1).value); }
table.push(["uString_charAt_getter_tail", "String", "charAt", false, uString_charAt_getter_tail]);
function uString_charAt_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charAt(holder(1).value); return [r]; }
table.push(["uString_charAt_getter_loop", "String", "charAt", false, uString_charAt_getter_loop]);
function uString_charAt_getter_watched(x: any, k: any): any { try { const r = x.charAt(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charAt_getter_watched", "String", "charAt", false, uString_charAt_getter_watched]);
function uString_charAt_own_plain(x: any, k: any): any { const r = x.charAt(alterOwn(x, "charAt", 1)); return [r]; }
table.push(["uString_charAt_own_plain", "String", "charAt", false, uString_charAt_own_plain]);
function uString_charAt_own_tail(x: any, k: any): any { return x.charAt(alterOwn(x, "charAt", 1)); }
table.push(["uString_charAt_own_tail", "String", "charAt", false, uString_charAt_own_tail]);
function uString_charAt_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charAt(alterOwn(x, "charAt", 1)); return [r]; }
table.push(["uString_charAt_own_loop", "String", "charAt", false, uString_charAt_own_loop]);
function uString_charAt_own_watched(x: any, k: any): any { try { const r = x.charAt(alterOwn(x, "charAt", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charAt_own_watched", "String", "charAt", false, uString_charAt_own_watched]);
function uString_charAt_prototype_plain(x: any, k: any): any { const r = x.charAt(alterPrototype(x, "charAt", 1)); return [r]; }
table.push(["uString_charAt_prototype_plain", "String", "charAt", false, uString_charAt_prototype_plain]);
function uString_charAt_prototype_tail(x: any, k: any): any { return x.charAt(alterPrototype(x, "charAt", 1)); }
table.push(["uString_charAt_prototype_tail", "String", "charAt", false, uString_charAt_prototype_tail]);
function uString_charAt_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charAt(alterPrototype(x, "charAt", 1)); return [r]; }
table.push(["uString_charAt_prototype_loop", "String", "charAt", false, uString_charAt_prototype_loop]);
function uString_charAt_prototype_watched(x: any, k: any): any { try { const r = x.charAt(alterPrototype(x, "charAt", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charAt_prototype_watched", "String", "charAt", false, uString_charAt_prototype_watched]);
function uString_charAt_round_plain(x: any, k: any): any { const r = x.charAt(addAndDelete(x, 1)); return [r]; }
table.push(["uString_charAt_round_plain", "String", "charAt", false, uString_charAt_round_plain]);
function uString_charAt_round_tail(x: any, k: any): any { return x.charAt(addAndDelete(x, 1)); }
table.push(["uString_charAt_round_tail", "String", "charAt", false, uString_charAt_round_tail]);
function uString_charAt_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charAt(addAndDelete(x, 1)); return [r]; }
table.push(["uString_charAt_round_loop", "String", "charAt", false, uString_charAt_round_loop]);
function uString_charAt_round_watched(x: any, k: any): any { try { const r = x.charAt(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charAt_round_watched", "String", "charAt", false, uString_charAt_round_watched]);
function uString_charAt_conditional_plain(x: any, k: any): any { const r = x.charAt((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_charAt_conditional_plain", "String", "charAt", false, uString_charAt_conditional_plain]);
function uString_charAt_conditional_tail(x: any, k: any): any { return x.charAt((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uString_charAt_conditional_tail", "String", "charAt", false, uString_charAt_conditional_tail]);
function uString_charAt_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charAt((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_charAt_conditional_loop", "String", "charAt", false, uString_charAt_conditional_loop]);
function uString_charAt_conditional_watched(x: any, k: any): any { try { const r = x.charAt((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charAt_conditional_watched", "String", "charAt", false, uString_charAt_conditional_watched]);
function uString_charAt_throws_plain(x: any, k: any): any { const r = x.charAt(fail(1)); return [r]; }
table.push(["uString_charAt_throws_plain", "String", "charAt", false, uString_charAt_throws_plain]);
function uString_charAt_throws_tail(x: any, k: any): any { return x.charAt(fail(1)); }
table.push(["uString_charAt_throws_tail", "String", "charAt", false, uString_charAt_throws_tail]);
function uString_charAt_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charAt(fail(1)); return [r]; }
table.push(["uString_charAt_throws_loop", "String", "charAt", false, uString_charAt_throws_loop]);
function uString_charAt_throws_watched(x: any, k: any): any { try { const r = x.charAt(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charAt_throws_watched", "String", "charAt", false, uString_charAt_throws_watched]);
function uString_charCodeAt_call_plain(x: any, k: any): any { const r = x.charCodeAt(note("argument", 1)); return [r]; }
table.push(["uString_charCodeAt_call_plain", "String", "charCodeAt", false, uString_charCodeAt_call_plain]);
function uString_charCodeAt_call_tail(x: any, k: any): any { return x.charCodeAt(note("argument", 1)); }
table.push(["uString_charCodeAt_call_tail", "String", "charCodeAt", false, uString_charCodeAt_call_tail]);
function uString_charCodeAt_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charCodeAt(note("argument", 1)); return [r]; }
table.push(["uString_charCodeAt_call_loop", "String", "charCodeAt", false, uString_charCodeAt_call_loop]);
function uString_charCodeAt_call_watched(x: any, k: any): any { try { const r = x.charCodeAt(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charCodeAt_call_watched", "String", "charCodeAt", false, uString_charCodeAt_call_watched]);
function uString_charCodeAt_getter_plain(x: any, k: any): any { const r = x.charCodeAt(holder(1).value); return [r]; }
table.push(["uString_charCodeAt_getter_plain", "String", "charCodeAt", false, uString_charCodeAt_getter_plain]);
function uString_charCodeAt_getter_tail(x: any, k: any): any { return x.charCodeAt(holder(1).value); }
table.push(["uString_charCodeAt_getter_tail", "String", "charCodeAt", false, uString_charCodeAt_getter_tail]);
function uString_charCodeAt_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charCodeAt(holder(1).value); return [r]; }
table.push(["uString_charCodeAt_getter_loop", "String", "charCodeAt", false, uString_charCodeAt_getter_loop]);
function uString_charCodeAt_getter_watched(x: any, k: any): any { try { const r = x.charCodeAt(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charCodeAt_getter_watched", "String", "charCodeAt", false, uString_charCodeAt_getter_watched]);
function uString_charCodeAt_own_plain(x: any, k: any): any { const r = x.charCodeAt(alterOwn(x, "charCodeAt", 1)); return [r]; }
table.push(["uString_charCodeAt_own_plain", "String", "charCodeAt", false, uString_charCodeAt_own_plain]);
function uString_charCodeAt_own_tail(x: any, k: any): any { return x.charCodeAt(alterOwn(x, "charCodeAt", 1)); }
table.push(["uString_charCodeAt_own_tail", "String", "charCodeAt", false, uString_charCodeAt_own_tail]);
function uString_charCodeAt_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charCodeAt(alterOwn(x, "charCodeAt", 1)); return [r]; }
table.push(["uString_charCodeAt_own_loop", "String", "charCodeAt", false, uString_charCodeAt_own_loop]);
function uString_charCodeAt_own_watched(x: any, k: any): any { try { const r = x.charCodeAt(alterOwn(x, "charCodeAt", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charCodeAt_own_watched", "String", "charCodeAt", false, uString_charCodeAt_own_watched]);
function uString_charCodeAt_prototype_plain(x: any, k: any): any { const r = x.charCodeAt(alterPrototype(x, "charCodeAt", 1)); return [r]; }
table.push(["uString_charCodeAt_prototype_plain", "String", "charCodeAt", false, uString_charCodeAt_prototype_plain]);
function uString_charCodeAt_prototype_tail(x: any, k: any): any { return x.charCodeAt(alterPrototype(x, "charCodeAt", 1)); }
table.push(["uString_charCodeAt_prototype_tail", "String", "charCodeAt", false, uString_charCodeAt_prototype_tail]);
function uString_charCodeAt_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charCodeAt(alterPrototype(x, "charCodeAt", 1)); return [r]; }
table.push(["uString_charCodeAt_prototype_loop", "String", "charCodeAt", false, uString_charCodeAt_prototype_loop]);
function uString_charCodeAt_prototype_watched(x: any, k: any): any { try { const r = x.charCodeAt(alterPrototype(x, "charCodeAt", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charCodeAt_prototype_watched", "String", "charCodeAt", false, uString_charCodeAt_prototype_watched]);
function uString_charCodeAt_round_plain(x: any, k: any): any { const r = x.charCodeAt(addAndDelete(x, 1)); return [r]; }
table.push(["uString_charCodeAt_round_plain", "String", "charCodeAt", false, uString_charCodeAt_round_plain]);
function uString_charCodeAt_round_tail(x: any, k: any): any { return x.charCodeAt(addAndDelete(x, 1)); }
table.push(["uString_charCodeAt_round_tail", "String", "charCodeAt", false, uString_charCodeAt_round_tail]);
function uString_charCodeAt_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charCodeAt(addAndDelete(x, 1)); return [r]; }
table.push(["uString_charCodeAt_round_loop", "String", "charCodeAt", false, uString_charCodeAt_round_loop]);
function uString_charCodeAt_round_watched(x: any, k: any): any { try { const r = x.charCodeAt(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charCodeAt_round_watched", "String", "charCodeAt", false, uString_charCodeAt_round_watched]);
function uString_charCodeAt_conditional_plain(x: any, k: any): any { const r = x.charCodeAt((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_charCodeAt_conditional_plain", "String", "charCodeAt", false, uString_charCodeAt_conditional_plain]);
function uString_charCodeAt_conditional_tail(x: any, k: any): any { return x.charCodeAt((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uString_charCodeAt_conditional_tail", "String", "charCodeAt", false, uString_charCodeAt_conditional_tail]);
function uString_charCodeAt_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charCodeAt((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_charCodeAt_conditional_loop", "String", "charCodeAt", false, uString_charCodeAt_conditional_loop]);
function uString_charCodeAt_conditional_watched(x: any, k: any): any { try { const r = x.charCodeAt((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charCodeAt_conditional_watched", "String", "charCodeAt", false, uString_charCodeAt_conditional_watched]);
function uString_charCodeAt_throws_plain(x: any, k: any): any { const r = x.charCodeAt(fail(1)); return [r]; }
table.push(["uString_charCodeAt_throws_plain", "String", "charCodeAt", false, uString_charCodeAt_throws_plain]);
function uString_charCodeAt_throws_tail(x: any, k: any): any { return x.charCodeAt(fail(1)); }
table.push(["uString_charCodeAt_throws_tail", "String", "charCodeAt", false, uString_charCodeAt_throws_tail]);
function uString_charCodeAt_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.charCodeAt(fail(1)); return [r]; }
table.push(["uString_charCodeAt_throws_loop", "String", "charCodeAt", false, uString_charCodeAt_throws_loop]);
function uString_charCodeAt_throws_watched(x: any, k: any): any { try { const r = x.charCodeAt(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_charCodeAt_throws_watched", "String", "charCodeAt", false, uString_charCodeAt_throws_watched]);
function uString_codePointAt_call_plain(x: any, k: any): any { const r = x.codePointAt(note("argument", 1)); return [r]; }
table.push(["uString_codePointAt_call_plain", "String", "codePointAt", false, uString_codePointAt_call_plain]);
function uString_codePointAt_call_tail(x: any, k: any): any { return x.codePointAt(note("argument", 1)); }
table.push(["uString_codePointAt_call_tail", "String", "codePointAt", false, uString_codePointAt_call_tail]);
function uString_codePointAt_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.codePointAt(note("argument", 1)); return [r]; }
table.push(["uString_codePointAt_call_loop", "String", "codePointAt", false, uString_codePointAt_call_loop]);
function uString_codePointAt_call_watched(x: any, k: any): any { try { const r = x.codePointAt(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_codePointAt_call_watched", "String", "codePointAt", false, uString_codePointAt_call_watched]);
function uString_codePointAt_getter_plain(x: any, k: any): any { const r = x.codePointAt(holder(1).value); return [r]; }
table.push(["uString_codePointAt_getter_plain", "String", "codePointAt", false, uString_codePointAt_getter_plain]);
function uString_codePointAt_getter_tail(x: any, k: any): any { return x.codePointAt(holder(1).value); }
table.push(["uString_codePointAt_getter_tail", "String", "codePointAt", false, uString_codePointAt_getter_tail]);
function uString_codePointAt_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.codePointAt(holder(1).value); return [r]; }
table.push(["uString_codePointAt_getter_loop", "String", "codePointAt", false, uString_codePointAt_getter_loop]);
function uString_codePointAt_getter_watched(x: any, k: any): any { try { const r = x.codePointAt(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_codePointAt_getter_watched", "String", "codePointAt", false, uString_codePointAt_getter_watched]);
function uString_codePointAt_own_plain(x: any, k: any): any { const r = x.codePointAt(alterOwn(x, "codePointAt", 1)); return [r]; }
table.push(["uString_codePointAt_own_plain", "String", "codePointAt", false, uString_codePointAt_own_plain]);
function uString_codePointAt_own_tail(x: any, k: any): any { return x.codePointAt(alterOwn(x, "codePointAt", 1)); }
table.push(["uString_codePointAt_own_tail", "String", "codePointAt", false, uString_codePointAt_own_tail]);
function uString_codePointAt_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.codePointAt(alterOwn(x, "codePointAt", 1)); return [r]; }
table.push(["uString_codePointAt_own_loop", "String", "codePointAt", false, uString_codePointAt_own_loop]);
function uString_codePointAt_own_watched(x: any, k: any): any { try { const r = x.codePointAt(alterOwn(x, "codePointAt", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_codePointAt_own_watched", "String", "codePointAt", false, uString_codePointAt_own_watched]);
function uString_codePointAt_prototype_plain(x: any, k: any): any { const r = x.codePointAt(alterPrototype(x, "codePointAt", 1)); return [r]; }
table.push(["uString_codePointAt_prototype_plain", "String", "codePointAt", false, uString_codePointAt_prototype_plain]);
function uString_codePointAt_prototype_tail(x: any, k: any): any { return x.codePointAt(alterPrototype(x, "codePointAt", 1)); }
table.push(["uString_codePointAt_prototype_tail", "String", "codePointAt", false, uString_codePointAt_prototype_tail]);
function uString_codePointAt_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.codePointAt(alterPrototype(x, "codePointAt", 1)); return [r]; }
table.push(["uString_codePointAt_prototype_loop", "String", "codePointAt", false, uString_codePointAt_prototype_loop]);
function uString_codePointAt_prototype_watched(x: any, k: any): any { try { const r = x.codePointAt(alterPrototype(x, "codePointAt", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_codePointAt_prototype_watched", "String", "codePointAt", false, uString_codePointAt_prototype_watched]);
function uString_codePointAt_round_plain(x: any, k: any): any { const r = x.codePointAt(addAndDelete(x, 1)); return [r]; }
table.push(["uString_codePointAt_round_plain", "String", "codePointAt", false, uString_codePointAt_round_plain]);
function uString_codePointAt_round_tail(x: any, k: any): any { return x.codePointAt(addAndDelete(x, 1)); }
table.push(["uString_codePointAt_round_tail", "String", "codePointAt", false, uString_codePointAt_round_tail]);
function uString_codePointAt_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.codePointAt(addAndDelete(x, 1)); return [r]; }
table.push(["uString_codePointAt_round_loop", "String", "codePointAt", false, uString_codePointAt_round_loop]);
function uString_codePointAt_round_watched(x: any, k: any): any { try { const r = x.codePointAt(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_codePointAt_round_watched", "String", "codePointAt", false, uString_codePointAt_round_watched]);
function uString_codePointAt_conditional_plain(x: any, k: any): any { const r = x.codePointAt((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_codePointAt_conditional_plain", "String", "codePointAt", false, uString_codePointAt_conditional_plain]);
function uString_codePointAt_conditional_tail(x: any, k: any): any { return x.codePointAt((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uString_codePointAt_conditional_tail", "String", "codePointAt", false, uString_codePointAt_conditional_tail]);
function uString_codePointAt_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.codePointAt((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_codePointAt_conditional_loop", "String", "codePointAt", false, uString_codePointAt_conditional_loop]);
function uString_codePointAt_conditional_watched(x: any, k: any): any { try { const r = x.codePointAt((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_codePointAt_conditional_watched", "String", "codePointAt", false, uString_codePointAt_conditional_watched]);
function uString_codePointAt_throws_plain(x: any, k: any): any { const r = x.codePointAt(fail(1)); return [r]; }
table.push(["uString_codePointAt_throws_plain", "String", "codePointAt", false, uString_codePointAt_throws_plain]);
function uString_codePointAt_throws_tail(x: any, k: any): any { return x.codePointAt(fail(1)); }
table.push(["uString_codePointAt_throws_tail", "String", "codePointAt", false, uString_codePointAt_throws_tail]);
function uString_codePointAt_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.codePointAt(fail(1)); return [r]; }
table.push(["uString_codePointAt_throws_loop", "String", "codePointAt", false, uString_codePointAt_throws_loop]);
function uString_codePointAt_throws_watched(x: any, k: any): any { try { const r = x.codePointAt(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_codePointAt_throws_watched", "String", "codePointAt", false, uString_codePointAt_throws_watched]);
function uString_repeat_call_plain(x: any, k: any): any { const r = x.repeat(note("argument", 2)); return [r]; }
table.push(["uString_repeat_call_plain", "String", "repeat", false, uString_repeat_call_plain]);
function uString_repeat_call_tail(x: any, k: any): any { return x.repeat(note("argument", 2)); }
table.push(["uString_repeat_call_tail", "String", "repeat", false, uString_repeat_call_tail]);
function uString_repeat_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.repeat(note("argument", 2)); return [r]; }
table.push(["uString_repeat_call_loop", "String", "repeat", false, uString_repeat_call_loop]);
function uString_repeat_call_watched(x: any, k: any): any { try { const r = x.repeat(note("argument", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_repeat_call_watched", "String", "repeat", false, uString_repeat_call_watched]);
function uString_repeat_getter_plain(x: any, k: any): any { const r = x.repeat(holder(2).value); return [r]; }
table.push(["uString_repeat_getter_plain", "String", "repeat", false, uString_repeat_getter_plain]);
function uString_repeat_getter_tail(x: any, k: any): any { return x.repeat(holder(2).value); }
table.push(["uString_repeat_getter_tail", "String", "repeat", false, uString_repeat_getter_tail]);
function uString_repeat_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.repeat(holder(2).value); return [r]; }
table.push(["uString_repeat_getter_loop", "String", "repeat", false, uString_repeat_getter_loop]);
function uString_repeat_getter_watched(x: any, k: any): any { try { const r = x.repeat(holder(2).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_repeat_getter_watched", "String", "repeat", false, uString_repeat_getter_watched]);
function uString_repeat_own_plain(x: any, k: any): any { const r = x.repeat(alterOwn(x, "repeat", 2)); return [r]; }
table.push(["uString_repeat_own_plain", "String", "repeat", false, uString_repeat_own_plain]);
function uString_repeat_own_tail(x: any, k: any): any { return x.repeat(alterOwn(x, "repeat", 2)); }
table.push(["uString_repeat_own_tail", "String", "repeat", false, uString_repeat_own_tail]);
function uString_repeat_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.repeat(alterOwn(x, "repeat", 2)); return [r]; }
table.push(["uString_repeat_own_loop", "String", "repeat", false, uString_repeat_own_loop]);
function uString_repeat_own_watched(x: any, k: any): any { try { const r = x.repeat(alterOwn(x, "repeat", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_repeat_own_watched", "String", "repeat", false, uString_repeat_own_watched]);
function uString_repeat_prototype_plain(x: any, k: any): any { const r = x.repeat(alterPrototype(x, "repeat", 2)); return [r]; }
table.push(["uString_repeat_prototype_plain", "String", "repeat", false, uString_repeat_prototype_plain]);
function uString_repeat_prototype_tail(x: any, k: any): any { return x.repeat(alterPrototype(x, "repeat", 2)); }
table.push(["uString_repeat_prototype_tail", "String", "repeat", false, uString_repeat_prototype_tail]);
function uString_repeat_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.repeat(alterPrototype(x, "repeat", 2)); return [r]; }
table.push(["uString_repeat_prototype_loop", "String", "repeat", false, uString_repeat_prototype_loop]);
function uString_repeat_prototype_watched(x: any, k: any): any { try { const r = x.repeat(alterPrototype(x, "repeat", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_repeat_prototype_watched", "String", "repeat", false, uString_repeat_prototype_watched]);
function uString_repeat_round_plain(x: any, k: any): any { const r = x.repeat(addAndDelete(x, 2)); return [r]; }
table.push(["uString_repeat_round_plain", "String", "repeat", false, uString_repeat_round_plain]);
function uString_repeat_round_tail(x: any, k: any): any { return x.repeat(addAndDelete(x, 2)); }
table.push(["uString_repeat_round_tail", "String", "repeat", false, uString_repeat_round_tail]);
function uString_repeat_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.repeat(addAndDelete(x, 2)); return [r]; }
table.push(["uString_repeat_round_loop", "String", "repeat", false, uString_repeat_round_loop]);
function uString_repeat_round_watched(x: any, k: any): any { try { const r = x.repeat(addAndDelete(x, 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_repeat_round_watched", "String", "repeat", false, uString_repeat_round_watched]);
function uString_repeat_conditional_plain(x: any, k: any): any { const r = x.repeat((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uString_repeat_conditional_plain", "String", "repeat", false, uString_repeat_conditional_plain]);
function uString_repeat_conditional_tail(x: any, k: any): any { return x.repeat((k ? note("yes", 2) : note("no", undefined))); }
table.push(["uString_repeat_conditional_tail", "String", "repeat", false, uString_repeat_conditional_tail]);
function uString_repeat_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.repeat((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["uString_repeat_conditional_loop", "String", "repeat", false, uString_repeat_conditional_loop]);
function uString_repeat_conditional_watched(x: any, k: any): any { try { const r = x.repeat((k ? note("yes", 2) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_repeat_conditional_watched", "String", "repeat", false, uString_repeat_conditional_watched]);
function uString_repeat_throws_plain(x: any, k: any): any { const r = x.repeat(fail(2)); return [r]; }
table.push(["uString_repeat_throws_plain", "String", "repeat", false, uString_repeat_throws_plain]);
function uString_repeat_throws_tail(x: any, k: any): any { return x.repeat(fail(2)); }
table.push(["uString_repeat_throws_tail", "String", "repeat", false, uString_repeat_throws_tail]);
function uString_repeat_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.repeat(fail(2)); return [r]; }
table.push(["uString_repeat_throws_loop", "String", "repeat", false, uString_repeat_throws_loop]);
function uString_repeat_throws_watched(x: any, k: any): any { try { const r = x.repeat(fail(2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_repeat_throws_watched", "String", "repeat", false, uString_repeat_throws_watched]);
function uString_localeCompare_call_plain(x: any, k: any): any { const r = x.localeCompare(note("argument", "b")); return [r]; }
table.push(["uString_localeCompare_call_plain", "String", "localeCompare", false, uString_localeCompare_call_plain]);
function uString_localeCompare_call_tail(x: any, k: any): any { return x.localeCompare(note("argument", "b")); }
table.push(["uString_localeCompare_call_tail", "String", "localeCompare", false, uString_localeCompare_call_tail]);
function uString_localeCompare_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.localeCompare(note("argument", "b")); return [r]; }
table.push(["uString_localeCompare_call_loop", "String", "localeCompare", false, uString_localeCompare_call_loop]);
function uString_localeCompare_call_watched(x: any, k: any): any { try { const r = x.localeCompare(note("argument", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_localeCompare_call_watched", "String", "localeCompare", false, uString_localeCompare_call_watched]);
function uString_localeCompare_getter_plain(x: any, k: any): any { const r = x.localeCompare(holder("b").value); return [r]; }
table.push(["uString_localeCompare_getter_plain", "String", "localeCompare", false, uString_localeCompare_getter_plain]);
function uString_localeCompare_getter_tail(x: any, k: any): any { return x.localeCompare(holder("b").value); }
table.push(["uString_localeCompare_getter_tail", "String", "localeCompare", false, uString_localeCompare_getter_tail]);
function uString_localeCompare_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.localeCompare(holder("b").value); return [r]; }
table.push(["uString_localeCompare_getter_loop", "String", "localeCompare", false, uString_localeCompare_getter_loop]);
function uString_localeCompare_getter_watched(x: any, k: any): any { try { const r = x.localeCompare(holder("b").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_localeCompare_getter_watched", "String", "localeCompare", false, uString_localeCompare_getter_watched]);
function uString_localeCompare_own_plain(x: any, k: any): any { const r = x.localeCompare(alterOwn(x, "localeCompare", "b")); return [r]; }
table.push(["uString_localeCompare_own_plain", "String", "localeCompare", false, uString_localeCompare_own_plain]);
function uString_localeCompare_own_tail(x: any, k: any): any { return x.localeCompare(alterOwn(x, "localeCompare", "b")); }
table.push(["uString_localeCompare_own_tail", "String", "localeCompare", false, uString_localeCompare_own_tail]);
function uString_localeCompare_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.localeCompare(alterOwn(x, "localeCompare", "b")); return [r]; }
table.push(["uString_localeCompare_own_loop", "String", "localeCompare", false, uString_localeCompare_own_loop]);
function uString_localeCompare_own_watched(x: any, k: any): any { try { const r = x.localeCompare(alterOwn(x, "localeCompare", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_localeCompare_own_watched", "String", "localeCompare", false, uString_localeCompare_own_watched]);
function uString_localeCompare_prototype_plain(x: any, k: any): any { const r = x.localeCompare(alterPrototype(x, "localeCompare", "b")); return [r]; }
table.push(["uString_localeCompare_prototype_plain", "String", "localeCompare", false, uString_localeCompare_prototype_plain]);
function uString_localeCompare_prototype_tail(x: any, k: any): any { return x.localeCompare(alterPrototype(x, "localeCompare", "b")); }
table.push(["uString_localeCompare_prototype_tail", "String", "localeCompare", false, uString_localeCompare_prototype_tail]);
function uString_localeCompare_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.localeCompare(alterPrototype(x, "localeCompare", "b")); return [r]; }
table.push(["uString_localeCompare_prototype_loop", "String", "localeCompare", false, uString_localeCompare_prototype_loop]);
function uString_localeCompare_prototype_watched(x: any, k: any): any { try { const r = x.localeCompare(alterPrototype(x, "localeCompare", "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_localeCompare_prototype_watched", "String", "localeCompare", false, uString_localeCompare_prototype_watched]);
function uString_localeCompare_round_plain(x: any, k: any): any { const r = x.localeCompare(addAndDelete(x, "b")); return [r]; }
table.push(["uString_localeCompare_round_plain", "String", "localeCompare", false, uString_localeCompare_round_plain]);
function uString_localeCompare_round_tail(x: any, k: any): any { return x.localeCompare(addAndDelete(x, "b")); }
table.push(["uString_localeCompare_round_tail", "String", "localeCompare", false, uString_localeCompare_round_tail]);
function uString_localeCompare_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.localeCompare(addAndDelete(x, "b")); return [r]; }
table.push(["uString_localeCompare_round_loop", "String", "localeCompare", false, uString_localeCompare_round_loop]);
function uString_localeCompare_round_watched(x: any, k: any): any { try { const r = x.localeCompare(addAndDelete(x, "b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_localeCompare_round_watched", "String", "localeCompare", false, uString_localeCompare_round_watched]);
function uString_localeCompare_conditional_plain(x: any, k: any): any { const r = x.localeCompare((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_localeCompare_conditional_plain", "String", "localeCompare", false, uString_localeCompare_conditional_plain]);
function uString_localeCompare_conditional_tail(x: any, k: any): any { return x.localeCompare((k ? note("yes", "b") : note("no", undefined))); }
table.push(["uString_localeCompare_conditional_tail", "String", "localeCompare", false, uString_localeCompare_conditional_tail]);
function uString_localeCompare_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.localeCompare((k ? note("yes", "b") : note("no", undefined))); return [r]; }
table.push(["uString_localeCompare_conditional_loop", "String", "localeCompare", false, uString_localeCompare_conditional_loop]);
function uString_localeCompare_conditional_watched(x: any, k: any): any { try { const r = x.localeCompare((k ? note("yes", "b") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_localeCompare_conditional_watched", "String", "localeCompare", false, uString_localeCompare_conditional_watched]);
function uString_localeCompare_throws_plain(x: any, k: any): any { const r = x.localeCompare(fail("b")); return [r]; }
table.push(["uString_localeCompare_throws_plain", "String", "localeCompare", false, uString_localeCompare_throws_plain]);
function uString_localeCompare_throws_tail(x: any, k: any): any { return x.localeCompare(fail("b")); }
table.push(["uString_localeCompare_throws_tail", "String", "localeCompare", false, uString_localeCompare_throws_tail]);
function uString_localeCompare_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.localeCompare(fail("b")); return [r]; }
table.push(["uString_localeCompare_throws_loop", "String", "localeCompare", false, uString_localeCompare_throws_loop]);
function uString_localeCompare_throws_watched(x: any, k: any): any { try { const r = x.localeCompare(fail("b")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_localeCompare_throws_watched", "String", "localeCompare", false, uString_localeCompare_throws_watched]);
function uString_substring_call_plain(x: any, k: any): any { const r = x.substring(note("argument", 1)); return [r]; }
table.push(["uString_substring_call_plain", "String", "substring", false, uString_substring_call_plain]);
function uString_substring_call_tail(x: any, k: any): any { return x.substring(note("argument", 1)); }
table.push(["uString_substring_call_tail", "String", "substring", false, uString_substring_call_tail]);
function uString_substring_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.substring(note("argument", 1)); return [r]; }
table.push(["uString_substring_call_loop", "String", "substring", false, uString_substring_call_loop]);
function uString_substring_call_watched(x: any, k: any): any { try { const r = x.substring(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_substring_call_watched", "String", "substring", false, uString_substring_call_watched]);
function uString_substring_getter_plain(x: any, k: any): any { const r = x.substring(holder(1).value); return [r]; }
table.push(["uString_substring_getter_plain", "String", "substring", false, uString_substring_getter_plain]);
function uString_substring_getter_tail(x: any, k: any): any { return x.substring(holder(1).value); }
table.push(["uString_substring_getter_tail", "String", "substring", false, uString_substring_getter_tail]);
function uString_substring_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.substring(holder(1).value); return [r]; }
table.push(["uString_substring_getter_loop", "String", "substring", false, uString_substring_getter_loop]);
function uString_substring_getter_watched(x: any, k: any): any { try { const r = x.substring(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_substring_getter_watched", "String", "substring", false, uString_substring_getter_watched]);
function uString_substring_own_plain(x: any, k: any): any { const r = x.substring(alterOwn(x, "substring", 1)); return [r]; }
table.push(["uString_substring_own_plain", "String", "substring", false, uString_substring_own_plain]);
function uString_substring_own_tail(x: any, k: any): any { return x.substring(alterOwn(x, "substring", 1)); }
table.push(["uString_substring_own_tail", "String", "substring", false, uString_substring_own_tail]);
function uString_substring_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.substring(alterOwn(x, "substring", 1)); return [r]; }
table.push(["uString_substring_own_loop", "String", "substring", false, uString_substring_own_loop]);
function uString_substring_own_watched(x: any, k: any): any { try { const r = x.substring(alterOwn(x, "substring", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_substring_own_watched", "String", "substring", false, uString_substring_own_watched]);
function uString_substring_prototype_plain(x: any, k: any): any { const r = x.substring(alterPrototype(x, "substring", 1)); return [r]; }
table.push(["uString_substring_prototype_plain", "String", "substring", false, uString_substring_prototype_plain]);
function uString_substring_prototype_tail(x: any, k: any): any { return x.substring(alterPrototype(x, "substring", 1)); }
table.push(["uString_substring_prototype_tail", "String", "substring", false, uString_substring_prototype_tail]);
function uString_substring_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.substring(alterPrototype(x, "substring", 1)); return [r]; }
table.push(["uString_substring_prototype_loop", "String", "substring", false, uString_substring_prototype_loop]);
function uString_substring_prototype_watched(x: any, k: any): any { try { const r = x.substring(alterPrototype(x, "substring", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_substring_prototype_watched", "String", "substring", false, uString_substring_prototype_watched]);
function uString_substring_round_plain(x: any, k: any): any { const r = x.substring(addAndDelete(x, 1)); return [r]; }
table.push(["uString_substring_round_plain", "String", "substring", false, uString_substring_round_plain]);
function uString_substring_round_tail(x: any, k: any): any { return x.substring(addAndDelete(x, 1)); }
table.push(["uString_substring_round_tail", "String", "substring", false, uString_substring_round_tail]);
function uString_substring_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.substring(addAndDelete(x, 1)); return [r]; }
table.push(["uString_substring_round_loop", "String", "substring", false, uString_substring_round_loop]);
function uString_substring_round_watched(x: any, k: any): any { try { const r = x.substring(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_substring_round_watched", "String", "substring", false, uString_substring_round_watched]);
function uString_substring_conditional_plain(x: any, k: any): any { const r = x.substring((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_substring_conditional_plain", "String", "substring", false, uString_substring_conditional_plain]);
function uString_substring_conditional_tail(x: any, k: any): any { return x.substring((k ? note("yes", 1) : note("no", undefined))); }
table.push(["uString_substring_conditional_tail", "String", "substring", false, uString_substring_conditional_tail]);
function uString_substring_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.substring((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["uString_substring_conditional_loop", "String", "substring", false, uString_substring_conditional_loop]);
function uString_substring_conditional_watched(x: any, k: any): any { try { const r = x.substring((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_substring_conditional_watched", "String", "substring", false, uString_substring_conditional_watched]);
function uString_substring_throws_plain(x: any, k: any): any { const r = x.substring(fail(1)); return [r]; }
table.push(["uString_substring_throws_plain", "String", "substring", false, uString_substring_throws_plain]);
function uString_substring_throws_tail(x: any, k: any): any { return x.substring(fail(1)); }
table.push(["uString_substring_throws_tail", "String", "substring", false, uString_substring_throws_tail]);
function uString_substring_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.substring(fail(1)); return [r]; }
table.push(["uString_substring_throws_loop", "String", "substring", false, uString_substring_throws_loop]);
function uString_substring_throws_watched(x: any, k: any): any { try { const r = x.substring(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_substring_throws_watched", "String", "substring", false, uString_substring_throws_watched]);
function uString_normalize_call_plain(x: any, k: any): any { const r = x.normalize(note("argument", "NFC")); return [r]; }
table.push(["uString_normalize_call_plain", "String", "normalize", false, uString_normalize_call_plain]);
function uString_normalize_call_tail(x: any, k: any): any { return x.normalize(note("argument", "NFC")); }
table.push(["uString_normalize_call_tail", "String", "normalize", false, uString_normalize_call_tail]);
function uString_normalize_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.normalize(note("argument", "NFC")); return [r]; }
table.push(["uString_normalize_call_loop", "String", "normalize", false, uString_normalize_call_loop]);
function uString_normalize_call_watched(x: any, k: any): any { try { const r = x.normalize(note("argument", "NFC")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_normalize_call_watched", "String", "normalize", false, uString_normalize_call_watched]);
function uString_normalize_getter_plain(x: any, k: any): any { const r = x.normalize(holder("NFC").value); return [r]; }
table.push(["uString_normalize_getter_plain", "String", "normalize", false, uString_normalize_getter_plain]);
function uString_normalize_getter_tail(x: any, k: any): any { return x.normalize(holder("NFC").value); }
table.push(["uString_normalize_getter_tail", "String", "normalize", false, uString_normalize_getter_tail]);
function uString_normalize_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.normalize(holder("NFC").value); return [r]; }
table.push(["uString_normalize_getter_loop", "String", "normalize", false, uString_normalize_getter_loop]);
function uString_normalize_getter_watched(x: any, k: any): any { try { const r = x.normalize(holder("NFC").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_normalize_getter_watched", "String", "normalize", false, uString_normalize_getter_watched]);
function uString_normalize_own_plain(x: any, k: any): any { const r = x.normalize(alterOwn(x, "normalize", "NFC")); return [r]; }
table.push(["uString_normalize_own_plain", "String", "normalize", false, uString_normalize_own_plain]);
function uString_normalize_own_tail(x: any, k: any): any { return x.normalize(alterOwn(x, "normalize", "NFC")); }
table.push(["uString_normalize_own_tail", "String", "normalize", false, uString_normalize_own_tail]);
function uString_normalize_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.normalize(alterOwn(x, "normalize", "NFC")); return [r]; }
table.push(["uString_normalize_own_loop", "String", "normalize", false, uString_normalize_own_loop]);
function uString_normalize_own_watched(x: any, k: any): any { try { const r = x.normalize(alterOwn(x, "normalize", "NFC")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_normalize_own_watched", "String", "normalize", false, uString_normalize_own_watched]);
function uString_normalize_prototype_plain(x: any, k: any): any { const r = x.normalize(alterPrototype(x, "normalize", "NFC")); return [r]; }
table.push(["uString_normalize_prototype_plain", "String", "normalize", false, uString_normalize_prototype_plain]);
function uString_normalize_prototype_tail(x: any, k: any): any { return x.normalize(alterPrototype(x, "normalize", "NFC")); }
table.push(["uString_normalize_prototype_tail", "String", "normalize", false, uString_normalize_prototype_tail]);
function uString_normalize_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.normalize(alterPrototype(x, "normalize", "NFC")); return [r]; }
table.push(["uString_normalize_prototype_loop", "String", "normalize", false, uString_normalize_prototype_loop]);
function uString_normalize_prototype_watched(x: any, k: any): any { try { const r = x.normalize(alterPrototype(x, "normalize", "NFC")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_normalize_prototype_watched", "String", "normalize", false, uString_normalize_prototype_watched]);
function uString_normalize_round_plain(x: any, k: any): any { const r = x.normalize(addAndDelete(x, "NFC")); return [r]; }
table.push(["uString_normalize_round_plain", "String", "normalize", false, uString_normalize_round_plain]);
function uString_normalize_round_tail(x: any, k: any): any { return x.normalize(addAndDelete(x, "NFC")); }
table.push(["uString_normalize_round_tail", "String", "normalize", false, uString_normalize_round_tail]);
function uString_normalize_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.normalize(addAndDelete(x, "NFC")); return [r]; }
table.push(["uString_normalize_round_loop", "String", "normalize", false, uString_normalize_round_loop]);
function uString_normalize_round_watched(x: any, k: any): any { try { const r = x.normalize(addAndDelete(x, "NFC")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_normalize_round_watched", "String", "normalize", false, uString_normalize_round_watched]);
function uString_normalize_conditional_plain(x: any, k: any): any { const r = x.normalize((k ? note("yes", "NFC") : note("no", undefined))); return [r]; }
table.push(["uString_normalize_conditional_plain", "String", "normalize", false, uString_normalize_conditional_plain]);
function uString_normalize_conditional_tail(x: any, k: any): any { return x.normalize((k ? note("yes", "NFC") : note("no", undefined))); }
table.push(["uString_normalize_conditional_tail", "String", "normalize", false, uString_normalize_conditional_tail]);
function uString_normalize_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.normalize((k ? note("yes", "NFC") : note("no", undefined))); return [r]; }
table.push(["uString_normalize_conditional_loop", "String", "normalize", false, uString_normalize_conditional_loop]);
function uString_normalize_conditional_watched(x: any, k: any): any { try { const r = x.normalize((k ? note("yes", "NFC") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_normalize_conditional_watched", "String", "normalize", false, uString_normalize_conditional_watched]);
function uString_normalize_throws_plain(x: any, k: any): any { const r = x.normalize(fail("NFC")); return [r]; }
table.push(["uString_normalize_throws_plain", "String", "normalize", false, uString_normalize_throws_plain]);
function uString_normalize_throws_tail(x: any, k: any): any { return x.normalize(fail("NFC")); }
table.push(["uString_normalize_throws_tail", "String", "normalize", false, uString_normalize_throws_tail]);
function uString_normalize_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.normalize(fail("NFC")); return [r]; }
table.push(["uString_normalize_throws_loop", "String", "normalize", false, uString_normalize_throws_loop]);
function uString_normalize_throws_watched(x: any, k: any): any { try { const r = x.normalize(fail("NFC")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_normalize_throws_watched", "String", "normalize", false, uString_normalize_throws_watched]);
function uString_replaceAll_call_plain(x: any, k: any): any { const r = x.replaceAll(note("argument", "b"), "x"); return [r]; }
table.push(["uString_replaceAll_call_plain", "String", "replaceAll", false, uString_replaceAll_call_plain]);
function uString_replaceAll_call_tail(x: any, k: any): any { return x.replaceAll(note("argument", "b"), "x"); }
table.push(["uString_replaceAll_call_tail", "String", "replaceAll", false, uString_replaceAll_call_tail]);
function uString_replaceAll_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replaceAll(note("argument", "b"), "x"); return [r]; }
table.push(["uString_replaceAll_call_loop", "String", "replaceAll", false, uString_replaceAll_call_loop]);
function uString_replaceAll_call_watched(x: any, k: any): any { try { const r = x.replaceAll(note("argument", "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replaceAll_call_watched", "String", "replaceAll", false, uString_replaceAll_call_watched]);
function uString_replaceAll_getter_plain(x: any, k: any): any { const r = x.replaceAll(holder("b").value, "x"); return [r]; }
table.push(["uString_replaceAll_getter_plain", "String", "replaceAll", false, uString_replaceAll_getter_plain]);
function uString_replaceAll_getter_tail(x: any, k: any): any { return x.replaceAll(holder("b").value, "x"); }
table.push(["uString_replaceAll_getter_tail", "String", "replaceAll", false, uString_replaceAll_getter_tail]);
function uString_replaceAll_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replaceAll(holder("b").value, "x"); return [r]; }
table.push(["uString_replaceAll_getter_loop", "String", "replaceAll", false, uString_replaceAll_getter_loop]);
function uString_replaceAll_getter_watched(x: any, k: any): any { try { const r = x.replaceAll(holder("b").value, "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replaceAll_getter_watched", "String", "replaceAll", false, uString_replaceAll_getter_watched]);
function uString_replaceAll_own_plain(x: any, k: any): any { const r = x.replaceAll(alterOwn(x, "replaceAll", "b"), "x"); return [r]; }
table.push(["uString_replaceAll_own_plain", "String", "replaceAll", false, uString_replaceAll_own_plain]);
function uString_replaceAll_own_tail(x: any, k: any): any { return x.replaceAll(alterOwn(x, "replaceAll", "b"), "x"); }
table.push(["uString_replaceAll_own_tail", "String", "replaceAll", false, uString_replaceAll_own_tail]);
function uString_replaceAll_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replaceAll(alterOwn(x, "replaceAll", "b"), "x"); return [r]; }
table.push(["uString_replaceAll_own_loop", "String", "replaceAll", false, uString_replaceAll_own_loop]);
function uString_replaceAll_own_watched(x: any, k: any): any { try { const r = x.replaceAll(alterOwn(x, "replaceAll", "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replaceAll_own_watched", "String", "replaceAll", false, uString_replaceAll_own_watched]);
function uString_replaceAll_prototype_plain(x: any, k: any): any { const r = x.replaceAll(alterPrototype(x, "replaceAll", "b"), "x"); return [r]; }
table.push(["uString_replaceAll_prototype_plain", "String", "replaceAll", false, uString_replaceAll_prototype_plain]);
function uString_replaceAll_prototype_tail(x: any, k: any): any { return x.replaceAll(alterPrototype(x, "replaceAll", "b"), "x"); }
table.push(["uString_replaceAll_prototype_tail", "String", "replaceAll", false, uString_replaceAll_prototype_tail]);
function uString_replaceAll_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replaceAll(alterPrototype(x, "replaceAll", "b"), "x"); return [r]; }
table.push(["uString_replaceAll_prototype_loop", "String", "replaceAll", false, uString_replaceAll_prototype_loop]);
function uString_replaceAll_prototype_watched(x: any, k: any): any { try { const r = x.replaceAll(alterPrototype(x, "replaceAll", "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replaceAll_prototype_watched", "String", "replaceAll", false, uString_replaceAll_prototype_watched]);
function uString_replaceAll_round_plain(x: any, k: any): any { const r = x.replaceAll(addAndDelete(x, "b"), "x"); return [r]; }
table.push(["uString_replaceAll_round_plain", "String", "replaceAll", false, uString_replaceAll_round_plain]);
function uString_replaceAll_round_tail(x: any, k: any): any { return x.replaceAll(addAndDelete(x, "b"), "x"); }
table.push(["uString_replaceAll_round_tail", "String", "replaceAll", false, uString_replaceAll_round_tail]);
function uString_replaceAll_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replaceAll(addAndDelete(x, "b"), "x"); return [r]; }
table.push(["uString_replaceAll_round_loop", "String", "replaceAll", false, uString_replaceAll_round_loop]);
function uString_replaceAll_round_watched(x: any, k: any): any { try { const r = x.replaceAll(addAndDelete(x, "b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replaceAll_round_watched", "String", "replaceAll", false, uString_replaceAll_round_watched]);
function uString_replaceAll_conditional_plain(x: any, k: any): any { const r = x.replaceAll((k ? note("yes", "b") : note("no", undefined)), "x"); return [r]; }
table.push(["uString_replaceAll_conditional_plain", "String", "replaceAll", false, uString_replaceAll_conditional_plain]);
function uString_replaceAll_conditional_tail(x: any, k: any): any { return x.replaceAll((k ? note("yes", "b") : note("no", undefined)), "x"); }
table.push(["uString_replaceAll_conditional_tail", "String", "replaceAll", false, uString_replaceAll_conditional_tail]);
function uString_replaceAll_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replaceAll((k ? note("yes", "b") : note("no", undefined)), "x"); return [r]; }
table.push(["uString_replaceAll_conditional_loop", "String", "replaceAll", false, uString_replaceAll_conditional_loop]);
function uString_replaceAll_conditional_watched(x: any, k: any): any { try { const r = x.replaceAll((k ? note("yes", "b") : note("no", undefined)), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replaceAll_conditional_watched", "String", "replaceAll", false, uString_replaceAll_conditional_watched]);
function uString_replaceAll_throws_plain(x: any, k: any): any { const r = x.replaceAll(fail("b"), "x"); return [r]; }
table.push(["uString_replaceAll_throws_plain", "String", "replaceAll", false, uString_replaceAll_throws_plain]);
function uString_replaceAll_throws_tail(x: any, k: any): any { return x.replaceAll(fail("b"), "x"); }
table.push(["uString_replaceAll_throws_tail", "String", "replaceAll", false, uString_replaceAll_throws_tail]);
function uString_replaceAll_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.replaceAll(fail("b"), "x"); return [r]; }
table.push(["uString_replaceAll_throws_loop", "String", "replaceAll", false, uString_replaceAll_throws_loop]);
function uString_replaceAll_throws_watched(x: any, k: any): any { try { const r = x.replaceAll(fail("b"), "x"); return [r]; } catch (e) { return thrown(e); } }
table.push(["uString_replaceAll_throws_watched", "String", "replaceAll", false, uString_replaceAll_throws_watched]);
function uMap_get_call_plain(x: any, k: any): any { const r = x.get(note("argument", "a")); return [r]; }
table.push(["uMap_get_call_plain", "Map", "get", false, uMap_get_call_plain]);
function uMap_get_call_tail(x: any, k: any): any { return x.get(note("argument", "a")); }
table.push(["uMap_get_call_tail", "Map", "get", false, uMap_get_call_tail]);
function uMap_get_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(note("argument", "a")); return [r]; }
table.push(["uMap_get_call_loop", "Map", "get", false, uMap_get_call_loop]);
function uMap_get_call_watched(x: any, k: any): any { try { const r = x.get(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_get_call_watched", "Map", "get", false, uMap_get_call_watched]);
function uMap_get_getter_plain(x: any, k: any): any { const r = x.get(holder("a").value); return [r]; }
table.push(["uMap_get_getter_plain", "Map", "get", false, uMap_get_getter_plain]);
function uMap_get_getter_tail(x: any, k: any): any { return x.get(holder("a").value); }
table.push(["uMap_get_getter_tail", "Map", "get", false, uMap_get_getter_tail]);
function uMap_get_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(holder("a").value); return [r]; }
table.push(["uMap_get_getter_loop", "Map", "get", false, uMap_get_getter_loop]);
function uMap_get_getter_watched(x: any, k: any): any { try { const r = x.get(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_get_getter_watched", "Map", "get", false, uMap_get_getter_watched]);
function uMap_get_own_plain(x: any, k: any): any { const r = x.get(alterOwn(x, "get", "a")); return [r]; }
table.push(["uMap_get_own_plain", "Map", "get", false, uMap_get_own_plain]);
function uMap_get_own_tail(x: any, k: any): any { return x.get(alterOwn(x, "get", "a")); }
table.push(["uMap_get_own_tail", "Map", "get", false, uMap_get_own_tail]);
function uMap_get_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(alterOwn(x, "get", "a")); return [r]; }
table.push(["uMap_get_own_loop", "Map", "get", false, uMap_get_own_loop]);
function uMap_get_own_watched(x: any, k: any): any { try { const r = x.get(alterOwn(x, "get", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_get_own_watched", "Map", "get", false, uMap_get_own_watched]);
function uMap_get_prototype_plain(x: any, k: any): any { const r = x.get(alterPrototype(x, "get", "a")); return [r]; }
table.push(["uMap_get_prototype_plain", "Map", "get", false, uMap_get_prototype_plain]);
function uMap_get_prototype_tail(x: any, k: any): any { return x.get(alterPrototype(x, "get", "a")); }
table.push(["uMap_get_prototype_tail", "Map", "get", false, uMap_get_prototype_tail]);
function uMap_get_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(alterPrototype(x, "get", "a")); return [r]; }
table.push(["uMap_get_prototype_loop", "Map", "get", false, uMap_get_prototype_loop]);
function uMap_get_prototype_watched(x: any, k: any): any { try { const r = x.get(alterPrototype(x, "get", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_get_prototype_watched", "Map", "get", false, uMap_get_prototype_watched]);
function uMap_get_round_plain(x: any, k: any): any { const r = x.get(addAndDelete(x, "a")); return [r]; }
table.push(["uMap_get_round_plain", "Map", "get", false, uMap_get_round_plain]);
function uMap_get_round_tail(x: any, k: any): any { return x.get(addAndDelete(x, "a")); }
table.push(["uMap_get_round_tail", "Map", "get", false, uMap_get_round_tail]);
function uMap_get_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(addAndDelete(x, "a")); return [r]; }
table.push(["uMap_get_round_loop", "Map", "get", false, uMap_get_round_loop]);
function uMap_get_round_watched(x: any, k: any): any { try { const r = x.get(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_get_round_watched", "Map", "get", false, uMap_get_round_watched]);
function uMap_get_conditional_plain(x: any, k: any): any { const r = x.get((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uMap_get_conditional_plain", "Map", "get", false, uMap_get_conditional_plain]);
function uMap_get_conditional_tail(x: any, k: any): any { return x.get((k ? note("yes", "a") : note("no", undefined))); }
table.push(["uMap_get_conditional_tail", "Map", "get", false, uMap_get_conditional_tail]);
function uMap_get_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uMap_get_conditional_loop", "Map", "get", false, uMap_get_conditional_loop]);
function uMap_get_conditional_watched(x: any, k: any): any { try { const r = x.get((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_get_conditional_watched", "Map", "get", false, uMap_get_conditional_watched]);
function uMap_get_throws_plain(x: any, k: any): any { const r = x.get(fail("a")); return [r]; }
table.push(["uMap_get_throws_plain", "Map", "get", false, uMap_get_throws_plain]);
function uMap_get_throws_tail(x: any, k: any): any { return x.get(fail("a")); }
table.push(["uMap_get_throws_tail", "Map", "get", false, uMap_get_throws_tail]);
function uMap_get_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(fail("a")); return [r]; }
table.push(["uMap_get_throws_loop", "Map", "get", false, uMap_get_throws_loop]);
function uMap_get_throws_watched(x: any, k: any): any { try { const r = x.get(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_get_throws_watched", "Map", "get", false, uMap_get_throws_watched]);
function uMap_has_call_plain(x: any, k: any): any { const r = x.has(note("argument", "a")); return [r]; }
table.push(["uMap_has_call_plain", "Map", "has", false, uMap_has_call_plain]);
function uMap_has_call_tail(x: any, k: any): any { return x.has(note("argument", "a")); }
table.push(["uMap_has_call_tail", "Map", "has", false, uMap_has_call_tail]);
function uMap_has_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(note("argument", "a")); return [r]; }
table.push(["uMap_has_call_loop", "Map", "has", false, uMap_has_call_loop]);
function uMap_has_call_watched(x: any, k: any): any { try { const r = x.has(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_has_call_watched", "Map", "has", false, uMap_has_call_watched]);
function uMap_has_getter_plain(x: any, k: any): any { const r = x.has(holder("a").value); return [r]; }
table.push(["uMap_has_getter_plain", "Map", "has", false, uMap_has_getter_plain]);
function uMap_has_getter_tail(x: any, k: any): any { return x.has(holder("a").value); }
table.push(["uMap_has_getter_tail", "Map", "has", false, uMap_has_getter_tail]);
function uMap_has_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(holder("a").value); return [r]; }
table.push(["uMap_has_getter_loop", "Map", "has", false, uMap_has_getter_loop]);
function uMap_has_getter_watched(x: any, k: any): any { try { const r = x.has(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_has_getter_watched", "Map", "has", false, uMap_has_getter_watched]);
function uMap_has_own_plain(x: any, k: any): any { const r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["uMap_has_own_plain", "Map", "has", false, uMap_has_own_plain]);
function uMap_has_own_tail(x: any, k: any): any { return x.has(alterOwn(x, "has", "a")); }
table.push(["uMap_has_own_tail", "Map", "has", false, uMap_has_own_tail]);
function uMap_has_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["uMap_has_own_loop", "Map", "has", false, uMap_has_own_loop]);
function uMap_has_own_watched(x: any, k: any): any { try { const r = x.has(alterOwn(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_has_own_watched", "Map", "has", false, uMap_has_own_watched]);
function uMap_has_prototype_plain(x: any, k: any): any { const r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["uMap_has_prototype_plain", "Map", "has", false, uMap_has_prototype_plain]);
function uMap_has_prototype_tail(x: any, k: any): any { return x.has(alterPrototype(x, "has", "a")); }
table.push(["uMap_has_prototype_tail", "Map", "has", false, uMap_has_prototype_tail]);
function uMap_has_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["uMap_has_prototype_loop", "Map", "has", false, uMap_has_prototype_loop]);
function uMap_has_prototype_watched(x: any, k: any): any { try { const r = x.has(alterPrototype(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_has_prototype_watched", "Map", "has", false, uMap_has_prototype_watched]);
function uMap_has_round_plain(x: any, k: any): any { const r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["uMap_has_round_plain", "Map", "has", false, uMap_has_round_plain]);
function uMap_has_round_tail(x: any, k: any): any { return x.has(addAndDelete(x, "a")); }
table.push(["uMap_has_round_tail", "Map", "has", false, uMap_has_round_tail]);
function uMap_has_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["uMap_has_round_loop", "Map", "has", false, uMap_has_round_loop]);
function uMap_has_round_watched(x: any, k: any): any { try { const r = x.has(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_has_round_watched", "Map", "has", false, uMap_has_round_watched]);
function uMap_has_conditional_plain(x: any, k: any): any { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uMap_has_conditional_plain", "Map", "has", false, uMap_has_conditional_plain]);
function uMap_has_conditional_tail(x: any, k: any): any { return x.has((k ? note("yes", "a") : note("no", undefined))); }
table.push(["uMap_has_conditional_tail", "Map", "has", false, uMap_has_conditional_tail]);
function uMap_has_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uMap_has_conditional_loop", "Map", "has", false, uMap_has_conditional_loop]);
function uMap_has_conditional_watched(x: any, k: any): any { try { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_has_conditional_watched", "Map", "has", false, uMap_has_conditional_watched]);
function uMap_has_throws_plain(x: any, k: any): any { const r = x.has(fail("a")); return [r]; }
table.push(["uMap_has_throws_plain", "Map", "has", false, uMap_has_throws_plain]);
function uMap_has_throws_tail(x: any, k: any): any { return x.has(fail("a")); }
table.push(["uMap_has_throws_tail", "Map", "has", false, uMap_has_throws_tail]);
function uMap_has_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(fail("a")); return [r]; }
table.push(["uMap_has_throws_loop", "Map", "has", false, uMap_has_throws_loop]);
function uMap_has_throws_watched(x: any, k: any): any { try { const r = x.has(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_has_throws_watched", "Map", "has", false, uMap_has_throws_watched]);
function uMap_set_call_plain(x: any, k: any): any { const r = x.set(note("argument", "c"), 3); return [r]; }
table.push(["uMap_set_call_plain", "Map", "set", false, uMap_set_call_plain]);
function uMap_set_call_tail(x: any, k: any): any { return x.set(note("argument", "c"), 3); }
table.push(["uMap_set_call_tail", "Map", "set", false, uMap_set_call_tail]);
function uMap_set_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(note("argument", "c"), 3); return [r]; }
table.push(["uMap_set_call_loop", "Map", "set", false, uMap_set_call_loop]);
function uMap_set_call_watched(x: any, k: any): any { try { const r = x.set(note("argument", "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_set_call_watched", "Map", "set", false, uMap_set_call_watched]);
function uMap_set_getter_plain(x: any, k: any): any { const r = x.set(holder("c").value, 3); return [r]; }
table.push(["uMap_set_getter_plain", "Map", "set", false, uMap_set_getter_plain]);
function uMap_set_getter_tail(x: any, k: any): any { return x.set(holder("c").value, 3); }
table.push(["uMap_set_getter_tail", "Map", "set", false, uMap_set_getter_tail]);
function uMap_set_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(holder("c").value, 3); return [r]; }
table.push(["uMap_set_getter_loop", "Map", "set", false, uMap_set_getter_loop]);
function uMap_set_getter_watched(x: any, k: any): any { try { const r = x.set(holder("c").value, 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_set_getter_watched", "Map", "set", false, uMap_set_getter_watched]);
function uMap_set_own_plain(x: any, k: any): any { const r = x.set(alterOwn(x, "set", "c"), 3); return [r]; }
table.push(["uMap_set_own_plain", "Map", "set", false, uMap_set_own_plain]);
function uMap_set_own_tail(x: any, k: any): any { return x.set(alterOwn(x, "set", "c"), 3); }
table.push(["uMap_set_own_tail", "Map", "set", false, uMap_set_own_tail]);
function uMap_set_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(alterOwn(x, "set", "c"), 3); return [r]; }
table.push(["uMap_set_own_loop", "Map", "set", false, uMap_set_own_loop]);
function uMap_set_own_watched(x: any, k: any): any { try { const r = x.set(alterOwn(x, "set", "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_set_own_watched", "Map", "set", false, uMap_set_own_watched]);
function uMap_set_prototype_plain(x: any, k: any): any { const r = x.set(alterPrototype(x, "set", "c"), 3); return [r]; }
table.push(["uMap_set_prototype_plain", "Map", "set", false, uMap_set_prototype_plain]);
function uMap_set_prototype_tail(x: any, k: any): any { return x.set(alterPrototype(x, "set", "c"), 3); }
table.push(["uMap_set_prototype_tail", "Map", "set", false, uMap_set_prototype_tail]);
function uMap_set_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(alterPrototype(x, "set", "c"), 3); return [r]; }
table.push(["uMap_set_prototype_loop", "Map", "set", false, uMap_set_prototype_loop]);
function uMap_set_prototype_watched(x: any, k: any): any { try { const r = x.set(alterPrototype(x, "set", "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_set_prototype_watched", "Map", "set", false, uMap_set_prototype_watched]);
function uMap_set_round_plain(x: any, k: any): any { const r = x.set(addAndDelete(x, "c"), 3); return [r]; }
table.push(["uMap_set_round_plain", "Map", "set", false, uMap_set_round_plain]);
function uMap_set_round_tail(x: any, k: any): any { return x.set(addAndDelete(x, "c"), 3); }
table.push(["uMap_set_round_tail", "Map", "set", false, uMap_set_round_tail]);
function uMap_set_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(addAndDelete(x, "c"), 3); return [r]; }
table.push(["uMap_set_round_loop", "Map", "set", false, uMap_set_round_loop]);
function uMap_set_round_watched(x: any, k: any): any { try { const r = x.set(addAndDelete(x, "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_set_round_watched", "Map", "set", false, uMap_set_round_watched]);
function uMap_set_conditional_plain(x: any, k: any): any { const r = x.set((k ? note("yes", "c") : note("no", undefined)), 3); return [r]; }
table.push(["uMap_set_conditional_plain", "Map", "set", false, uMap_set_conditional_plain]);
function uMap_set_conditional_tail(x: any, k: any): any { return x.set((k ? note("yes", "c") : note("no", undefined)), 3); }
table.push(["uMap_set_conditional_tail", "Map", "set", false, uMap_set_conditional_tail]);
function uMap_set_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set((k ? note("yes", "c") : note("no", undefined)), 3); return [r]; }
table.push(["uMap_set_conditional_loop", "Map", "set", false, uMap_set_conditional_loop]);
function uMap_set_conditional_watched(x: any, k: any): any { try { const r = x.set((k ? note("yes", "c") : note("no", undefined)), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_set_conditional_watched", "Map", "set", false, uMap_set_conditional_watched]);
function uMap_set_throws_plain(x: any, k: any): any { const r = x.set(fail("c"), 3); return [r]; }
table.push(["uMap_set_throws_plain", "Map", "set", false, uMap_set_throws_plain]);
function uMap_set_throws_tail(x: any, k: any): any { return x.set(fail("c"), 3); }
table.push(["uMap_set_throws_tail", "Map", "set", false, uMap_set_throws_tail]);
function uMap_set_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(fail("c"), 3); return [r]; }
table.push(["uMap_set_throws_loop", "Map", "set", false, uMap_set_throws_loop]);
function uMap_set_throws_watched(x: any, k: any): any { try { const r = x.set(fail("c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_set_throws_watched", "Map", "set", false, uMap_set_throws_watched]);
function uMap_delete_call_plain(x: any, k: any): any { const r = x.delete(note("argument", "a")); return [r]; }
table.push(["uMap_delete_call_plain", "Map", "delete", false, uMap_delete_call_plain]);
function uMap_delete_call_tail(x: any, k: any): any { return x.delete(note("argument", "a")); }
table.push(["uMap_delete_call_tail", "Map", "delete", false, uMap_delete_call_tail]);
function uMap_delete_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(note("argument", "a")); return [r]; }
table.push(["uMap_delete_call_loop", "Map", "delete", false, uMap_delete_call_loop]);
function uMap_delete_call_watched(x: any, k: any): any { try { const r = x.delete(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_delete_call_watched", "Map", "delete", false, uMap_delete_call_watched]);
function uMap_delete_getter_plain(x: any, k: any): any { const r = x.delete(holder("a").value); return [r]; }
table.push(["uMap_delete_getter_plain", "Map", "delete", false, uMap_delete_getter_plain]);
function uMap_delete_getter_tail(x: any, k: any): any { return x.delete(holder("a").value); }
table.push(["uMap_delete_getter_tail", "Map", "delete", false, uMap_delete_getter_tail]);
function uMap_delete_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(holder("a").value); return [r]; }
table.push(["uMap_delete_getter_loop", "Map", "delete", false, uMap_delete_getter_loop]);
function uMap_delete_getter_watched(x: any, k: any): any { try { const r = x.delete(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_delete_getter_watched", "Map", "delete", false, uMap_delete_getter_watched]);
function uMap_delete_own_plain(x: any, k: any): any { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["uMap_delete_own_plain", "Map", "delete", false, uMap_delete_own_plain]);
function uMap_delete_own_tail(x: any, k: any): any { return x.delete(alterOwn(x, "delete", "a")); }
table.push(["uMap_delete_own_tail", "Map", "delete", false, uMap_delete_own_tail]);
function uMap_delete_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["uMap_delete_own_loop", "Map", "delete", false, uMap_delete_own_loop]);
function uMap_delete_own_watched(x: any, k: any): any { try { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_delete_own_watched", "Map", "delete", false, uMap_delete_own_watched]);
function uMap_delete_prototype_plain(x: any, k: any): any { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["uMap_delete_prototype_plain", "Map", "delete", false, uMap_delete_prototype_plain]);
function uMap_delete_prototype_tail(x: any, k: any): any { return x.delete(alterPrototype(x, "delete", "a")); }
table.push(["uMap_delete_prototype_tail", "Map", "delete", false, uMap_delete_prototype_tail]);
function uMap_delete_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["uMap_delete_prototype_loop", "Map", "delete", false, uMap_delete_prototype_loop]);
function uMap_delete_prototype_watched(x: any, k: any): any { try { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_delete_prototype_watched", "Map", "delete", false, uMap_delete_prototype_watched]);
function uMap_delete_round_plain(x: any, k: any): any { const r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["uMap_delete_round_plain", "Map", "delete", false, uMap_delete_round_plain]);
function uMap_delete_round_tail(x: any, k: any): any { return x.delete(addAndDelete(x, "a")); }
table.push(["uMap_delete_round_tail", "Map", "delete", false, uMap_delete_round_tail]);
function uMap_delete_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["uMap_delete_round_loop", "Map", "delete", false, uMap_delete_round_loop]);
function uMap_delete_round_watched(x: any, k: any): any { try { const r = x.delete(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_delete_round_watched", "Map", "delete", false, uMap_delete_round_watched]);
function uMap_delete_conditional_plain(x: any, k: any): any { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uMap_delete_conditional_plain", "Map", "delete", false, uMap_delete_conditional_plain]);
function uMap_delete_conditional_tail(x: any, k: any): any { return x.delete((k ? note("yes", "a") : note("no", undefined))); }
table.push(["uMap_delete_conditional_tail", "Map", "delete", false, uMap_delete_conditional_tail]);
function uMap_delete_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uMap_delete_conditional_loop", "Map", "delete", false, uMap_delete_conditional_loop]);
function uMap_delete_conditional_watched(x: any, k: any): any { try { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_delete_conditional_watched", "Map", "delete", false, uMap_delete_conditional_watched]);
function uMap_delete_throws_plain(x: any, k: any): any { const r = x.delete(fail("a")); return [r]; }
table.push(["uMap_delete_throws_plain", "Map", "delete", false, uMap_delete_throws_plain]);
function uMap_delete_throws_tail(x: any, k: any): any { return x.delete(fail("a")); }
table.push(["uMap_delete_throws_tail", "Map", "delete", false, uMap_delete_throws_tail]);
function uMap_delete_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(fail("a")); return [r]; }
table.push(["uMap_delete_throws_loop", "Map", "delete", false, uMap_delete_throws_loop]);
function uMap_delete_throws_watched(x: any, k: any): any { try { const r = x.delete(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uMap_delete_throws_watched", "Map", "delete", false, uMap_delete_throws_watched]);
function uSet_has_call_plain(x: any, k: any): any { const r = x.has(note("argument", "a")); return [r]; }
table.push(["uSet_has_call_plain", "Set", "has", false, uSet_has_call_plain]);
function uSet_has_call_tail(x: any, k: any): any { return x.has(note("argument", "a")); }
table.push(["uSet_has_call_tail", "Set", "has", false, uSet_has_call_tail]);
function uSet_has_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(note("argument", "a")); return [r]; }
table.push(["uSet_has_call_loop", "Set", "has", false, uSet_has_call_loop]);
function uSet_has_call_watched(x: any, k: any): any { try { const r = x.has(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_has_call_watched", "Set", "has", false, uSet_has_call_watched]);
function uSet_has_getter_plain(x: any, k: any): any { const r = x.has(holder("a").value); return [r]; }
table.push(["uSet_has_getter_plain", "Set", "has", false, uSet_has_getter_plain]);
function uSet_has_getter_tail(x: any, k: any): any { return x.has(holder("a").value); }
table.push(["uSet_has_getter_tail", "Set", "has", false, uSet_has_getter_tail]);
function uSet_has_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(holder("a").value); return [r]; }
table.push(["uSet_has_getter_loop", "Set", "has", false, uSet_has_getter_loop]);
function uSet_has_getter_watched(x: any, k: any): any { try { const r = x.has(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_has_getter_watched", "Set", "has", false, uSet_has_getter_watched]);
function uSet_has_own_plain(x: any, k: any): any { const r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["uSet_has_own_plain", "Set", "has", false, uSet_has_own_plain]);
function uSet_has_own_tail(x: any, k: any): any { return x.has(alterOwn(x, "has", "a")); }
table.push(["uSet_has_own_tail", "Set", "has", false, uSet_has_own_tail]);
function uSet_has_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["uSet_has_own_loop", "Set", "has", false, uSet_has_own_loop]);
function uSet_has_own_watched(x: any, k: any): any { try { const r = x.has(alterOwn(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_has_own_watched", "Set", "has", false, uSet_has_own_watched]);
function uSet_has_prototype_plain(x: any, k: any): any { const r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["uSet_has_prototype_plain", "Set", "has", false, uSet_has_prototype_plain]);
function uSet_has_prototype_tail(x: any, k: any): any { return x.has(alterPrototype(x, "has", "a")); }
table.push(["uSet_has_prototype_tail", "Set", "has", false, uSet_has_prototype_tail]);
function uSet_has_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["uSet_has_prototype_loop", "Set", "has", false, uSet_has_prototype_loop]);
function uSet_has_prototype_watched(x: any, k: any): any { try { const r = x.has(alterPrototype(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_has_prototype_watched", "Set", "has", false, uSet_has_prototype_watched]);
function uSet_has_round_plain(x: any, k: any): any { const r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["uSet_has_round_plain", "Set", "has", false, uSet_has_round_plain]);
function uSet_has_round_tail(x: any, k: any): any { return x.has(addAndDelete(x, "a")); }
table.push(["uSet_has_round_tail", "Set", "has", false, uSet_has_round_tail]);
function uSet_has_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["uSet_has_round_loop", "Set", "has", false, uSet_has_round_loop]);
function uSet_has_round_watched(x: any, k: any): any { try { const r = x.has(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_has_round_watched", "Set", "has", false, uSet_has_round_watched]);
function uSet_has_conditional_plain(x: any, k: any): any { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uSet_has_conditional_plain", "Set", "has", false, uSet_has_conditional_plain]);
function uSet_has_conditional_tail(x: any, k: any): any { return x.has((k ? note("yes", "a") : note("no", undefined))); }
table.push(["uSet_has_conditional_tail", "Set", "has", false, uSet_has_conditional_tail]);
function uSet_has_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uSet_has_conditional_loop", "Set", "has", false, uSet_has_conditional_loop]);
function uSet_has_conditional_watched(x: any, k: any): any { try { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_has_conditional_watched", "Set", "has", false, uSet_has_conditional_watched]);
function uSet_has_throws_plain(x: any, k: any): any { const r = x.has(fail("a")); return [r]; }
table.push(["uSet_has_throws_plain", "Set", "has", false, uSet_has_throws_plain]);
function uSet_has_throws_tail(x: any, k: any): any { return x.has(fail("a")); }
table.push(["uSet_has_throws_tail", "Set", "has", false, uSet_has_throws_tail]);
function uSet_has_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(fail("a")); return [r]; }
table.push(["uSet_has_throws_loop", "Set", "has", false, uSet_has_throws_loop]);
function uSet_has_throws_watched(x: any, k: any): any { try { const r = x.has(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_has_throws_watched", "Set", "has", false, uSet_has_throws_watched]);
function uSet_add_call_plain(x: any, k: any): any { const r = x.add(note("argument", "c")); return [r]; }
table.push(["uSet_add_call_plain", "Set", "add", false, uSet_add_call_plain]);
function uSet_add_call_tail(x: any, k: any): any { return x.add(note("argument", "c")); }
table.push(["uSet_add_call_tail", "Set", "add", false, uSet_add_call_tail]);
function uSet_add_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(note("argument", "c")); return [r]; }
table.push(["uSet_add_call_loop", "Set", "add", false, uSet_add_call_loop]);
function uSet_add_call_watched(x: any, k: any): any { try { const r = x.add(note("argument", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_add_call_watched", "Set", "add", false, uSet_add_call_watched]);
function uSet_add_getter_plain(x: any, k: any): any { const r = x.add(holder("c").value); return [r]; }
table.push(["uSet_add_getter_plain", "Set", "add", false, uSet_add_getter_plain]);
function uSet_add_getter_tail(x: any, k: any): any { return x.add(holder("c").value); }
table.push(["uSet_add_getter_tail", "Set", "add", false, uSet_add_getter_tail]);
function uSet_add_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(holder("c").value); return [r]; }
table.push(["uSet_add_getter_loop", "Set", "add", false, uSet_add_getter_loop]);
function uSet_add_getter_watched(x: any, k: any): any { try { const r = x.add(holder("c").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_add_getter_watched", "Set", "add", false, uSet_add_getter_watched]);
function uSet_add_own_plain(x: any, k: any): any { const r = x.add(alterOwn(x, "add", "c")); return [r]; }
table.push(["uSet_add_own_plain", "Set", "add", false, uSet_add_own_plain]);
function uSet_add_own_tail(x: any, k: any): any { return x.add(alterOwn(x, "add", "c")); }
table.push(["uSet_add_own_tail", "Set", "add", false, uSet_add_own_tail]);
function uSet_add_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(alterOwn(x, "add", "c")); return [r]; }
table.push(["uSet_add_own_loop", "Set", "add", false, uSet_add_own_loop]);
function uSet_add_own_watched(x: any, k: any): any { try { const r = x.add(alterOwn(x, "add", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_add_own_watched", "Set", "add", false, uSet_add_own_watched]);
function uSet_add_prototype_plain(x: any, k: any): any { const r = x.add(alterPrototype(x, "add", "c")); return [r]; }
table.push(["uSet_add_prototype_plain", "Set", "add", false, uSet_add_prototype_plain]);
function uSet_add_prototype_tail(x: any, k: any): any { return x.add(alterPrototype(x, "add", "c")); }
table.push(["uSet_add_prototype_tail", "Set", "add", false, uSet_add_prototype_tail]);
function uSet_add_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(alterPrototype(x, "add", "c")); return [r]; }
table.push(["uSet_add_prototype_loop", "Set", "add", false, uSet_add_prototype_loop]);
function uSet_add_prototype_watched(x: any, k: any): any { try { const r = x.add(alterPrototype(x, "add", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_add_prototype_watched", "Set", "add", false, uSet_add_prototype_watched]);
function uSet_add_round_plain(x: any, k: any): any { const r = x.add(addAndDelete(x, "c")); return [r]; }
table.push(["uSet_add_round_plain", "Set", "add", false, uSet_add_round_plain]);
function uSet_add_round_tail(x: any, k: any): any { return x.add(addAndDelete(x, "c")); }
table.push(["uSet_add_round_tail", "Set", "add", false, uSet_add_round_tail]);
function uSet_add_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(addAndDelete(x, "c")); return [r]; }
table.push(["uSet_add_round_loop", "Set", "add", false, uSet_add_round_loop]);
function uSet_add_round_watched(x: any, k: any): any { try { const r = x.add(addAndDelete(x, "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_add_round_watched", "Set", "add", false, uSet_add_round_watched]);
function uSet_add_conditional_plain(x: any, k: any): any { const r = x.add((k ? note("yes", "c") : note("no", undefined))); return [r]; }
table.push(["uSet_add_conditional_plain", "Set", "add", false, uSet_add_conditional_plain]);
function uSet_add_conditional_tail(x: any, k: any): any { return x.add((k ? note("yes", "c") : note("no", undefined))); }
table.push(["uSet_add_conditional_tail", "Set", "add", false, uSet_add_conditional_tail]);
function uSet_add_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add((k ? note("yes", "c") : note("no", undefined))); return [r]; }
table.push(["uSet_add_conditional_loop", "Set", "add", false, uSet_add_conditional_loop]);
function uSet_add_conditional_watched(x: any, k: any): any { try { const r = x.add((k ? note("yes", "c") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_add_conditional_watched", "Set", "add", false, uSet_add_conditional_watched]);
function uSet_add_throws_plain(x: any, k: any): any { const r = x.add(fail("c")); return [r]; }
table.push(["uSet_add_throws_plain", "Set", "add", false, uSet_add_throws_plain]);
function uSet_add_throws_tail(x: any, k: any): any { return x.add(fail("c")); }
table.push(["uSet_add_throws_tail", "Set", "add", false, uSet_add_throws_tail]);
function uSet_add_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(fail("c")); return [r]; }
table.push(["uSet_add_throws_loop", "Set", "add", false, uSet_add_throws_loop]);
function uSet_add_throws_watched(x: any, k: any): any { try { const r = x.add(fail("c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_add_throws_watched", "Set", "add", false, uSet_add_throws_watched]);
function uSet_delete_call_plain(x: any, k: any): any { const r = x.delete(note("argument", "a")); return [r]; }
table.push(["uSet_delete_call_plain", "Set", "delete", false, uSet_delete_call_plain]);
function uSet_delete_call_tail(x: any, k: any): any { return x.delete(note("argument", "a")); }
table.push(["uSet_delete_call_tail", "Set", "delete", false, uSet_delete_call_tail]);
function uSet_delete_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(note("argument", "a")); return [r]; }
table.push(["uSet_delete_call_loop", "Set", "delete", false, uSet_delete_call_loop]);
function uSet_delete_call_watched(x: any, k: any): any { try { const r = x.delete(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_delete_call_watched", "Set", "delete", false, uSet_delete_call_watched]);
function uSet_delete_getter_plain(x: any, k: any): any { const r = x.delete(holder("a").value); return [r]; }
table.push(["uSet_delete_getter_plain", "Set", "delete", false, uSet_delete_getter_plain]);
function uSet_delete_getter_tail(x: any, k: any): any { return x.delete(holder("a").value); }
table.push(["uSet_delete_getter_tail", "Set", "delete", false, uSet_delete_getter_tail]);
function uSet_delete_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(holder("a").value); return [r]; }
table.push(["uSet_delete_getter_loop", "Set", "delete", false, uSet_delete_getter_loop]);
function uSet_delete_getter_watched(x: any, k: any): any { try { const r = x.delete(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_delete_getter_watched", "Set", "delete", false, uSet_delete_getter_watched]);
function uSet_delete_own_plain(x: any, k: any): any { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["uSet_delete_own_plain", "Set", "delete", false, uSet_delete_own_plain]);
function uSet_delete_own_tail(x: any, k: any): any { return x.delete(alterOwn(x, "delete", "a")); }
table.push(["uSet_delete_own_tail", "Set", "delete", false, uSet_delete_own_tail]);
function uSet_delete_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["uSet_delete_own_loop", "Set", "delete", false, uSet_delete_own_loop]);
function uSet_delete_own_watched(x: any, k: any): any { try { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_delete_own_watched", "Set", "delete", false, uSet_delete_own_watched]);
function uSet_delete_prototype_plain(x: any, k: any): any { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["uSet_delete_prototype_plain", "Set", "delete", false, uSet_delete_prototype_plain]);
function uSet_delete_prototype_tail(x: any, k: any): any { return x.delete(alterPrototype(x, "delete", "a")); }
table.push(["uSet_delete_prototype_tail", "Set", "delete", false, uSet_delete_prototype_tail]);
function uSet_delete_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["uSet_delete_prototype_loop", "Set", "delete", false, uSet_delete_prototype_loop]);
function uSet_delete_prototype_watched(x: any, k: any): any { try { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_delete_prototype_watched", "Set", "delete", false, uSet_delete_prototype_watched]);
function uSet_delete_round_plain(x: any, k: any): any { const r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["uSet_delete_round_plain", "Set", "delete", false, uSet_delete_round_plain]);
function uSet_delete_round_tail(x: any, k: any): any { return x.delete(addAndDelete(x, "a")); }
table.push(["uSet_delete_round_tail", "Set", "delete", false, uSet_delete_round_tail]);
function uSet_delete_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["uSet_delete_round_loop", "Set", "delete", false, uSet_delete_round_loop]);
function uSet_delete_round_watched(x: any, k: any): any { try { const r = x.delete(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_delete_round_watched", "Set", "delete", false, uSet_delete_round_watched]);
function uSet_delete_conditional_plain(x: any, k: any): any { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uSet_delete_conditional_plain", "Set", "delete", false, uSet_delete_conditional_plain]);
function uSet_delete_conditional_tail(x: any, k: any): any { return x.delete((k ? note("yes", "a") : note("no", undefined))); }
table.push(["uSet_delete_conditional_tail", "Set", "delete", false, uSet_delete_conditional_tail]);
function uSet_delete_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["uSet_delete_conditional_loop", "Set", "delete", false, uSet_delete_conditional_loop]);
function uSet_delete_conditional_watched(x: any, k: any): any { try { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_delete_conditional_watched", "Set", "delete", false, uSet_delete_conditional_watched]);
function uSet_delete_throws_plain(x: any, k: any): any { const r = x.delete(fail("a")); return [r]; }
table.push(["uSet_delete_throws_plain", "Set", "delete", false, uSet_delete_throws_plain]);
function uSet_delete_throws_tail(x: any, k: any): any { return x.delete(fail("a")); }
table.push(["uSet_delete_throws_tail", "Set", "delete", false, uSet_delete_throws_tail]);
function uSet_delete_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(fail("a")); return [r]; }
table.push(["uSet_delete_throws_loop", "Set", "delete", false, uSet_delete_throws_loop]);
function uSet_delete_throws_watched(x: any, k: any): any { try { const r = x.delete(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_delete_throws_watched", "Set", "delete", false, uSet_delete_throws_watched]);
function uSet_union_call_plain(x: any, k: any): any { const r = x.union(note("argument", other)); return [r]; }
table.push(["uSet_union_call_plain", "Set", "union", false, uSet_union_call_plain]);
function uSet_union_call_tail(x: any, k: any): any { return x.union(note("argument", other)); }
table.push(["uSet_union_call_tail", "Set", "union", false, uSet_union_call_tail]);
function uSet_union_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(note("argument", other)); return [r]; }
table.push(["uSet_union_call_loop", "Set", "union", false, uSet_union_call_loop]);
function uSet_union_call_watched(x: any, k: any): any { try { const r = x.union(note("argument", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_union_call_watched", "Set", "union", false, uSet_union_call_watched]);
function uSet_union_getter_plain(x: any, k: any): any { const r = x.union(holder(other).value); return [r]; }
table.push(["uSet_union_getter_plain", "Set", "union", false, uSet_union_getter_plain]);
function uSet_union_getter_tail(x: any, k: any): any { return x.union(holder(other).value); }
table.push(["uSet_union_getter_tail", "Set", "union", false, uSet_union_getter_tail]);
function uSet_union_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(holder(other).value); return [r]; }
table.push(["uSet_union_getter_loop", "Set", "union", false, uSet_union_getter_loop]);
function uSet_union_getter_watched(x: any, k: any): any { try { const r = x.union(holder(other).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_union_getter_watched", "Set", "union", false, uSet_union_getter_watched]);
function uSet_union_own_plain(x: any, k: any): any { const r = x.union(alterOwn(x, "union", other)); return [r]; }
table.push(["uSet_union_own_plain", "Set", "union", false, uSet_union_own_plain]);
function uSet_union_own_tail(x: any, k: any): any { return x.union(alterOwn(x, "union", other)); }
table.push(["uSet_union_own_tail", "Set", "union", false, uSet_union_own_tail]);
function uSet_union_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(alterOwn(x, "union", other)); return [r]; }
table.push(["uSet_union_own_loop", "Set", "union", false, uSet_union_own_loop]);
function uSet_union_own_watched(x: any, k: any): any { try { const r = x.union(alterOwn(x, "union", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_union_own_watched", "Set", "union", false, uSet_union_own_watched]);
function uSet_union_prototype_plain(x: any, k: any): any { const r = x.union(alterPrototype(x, "union", other)); return [r]; }
table.push(["uSet_union_prototype_plain", "Set", "union", false, uSet_union_prototype_plain]);
function uSet_union_prototype_tail(x: any, k: any): any { return x.union(alterPrototype(x, "union", other)); }
table.push(["uSet_union_prototype_tail", "Set", "union", false, uSet_union_prototype_tail]);
function uSet_union_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(alterPrototype(x, "union", other)); return [r]; }
table.push(["uSet_union_prototype_loop", "Set", "union", false, uSet_union_prototype_loop]);
function uSet_union_prototype_watched(x: any, k: any): any { try { const r = x.union(alterPrototype(x, "union", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_union_prototype_watched", "Set", "union", false, uSet_union_prototype_watched]);
function uSet_union_round_plain(x: any, k: any): any { const r = x.union(addAndDelete(x, other)); return [r]; }
table.push(["uSet_union_round_plain", "Set", "union", false, uSet_union_round_plain]);
function uSet_union_round_tail(x: any, k: any): any { return x.union(addAndDelete(x, other)); }
table.push(["uSet_union_round_tail", "Set", "union", false, uSet_union_round_tail]);
function uSet_union_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(addAndDelete(x, other)); return [r]; }
table.push(["uSet_union_round_loop", "Set", "union", false, uSet_union_round_loop]);
function uSet_union_round_watched(x: any, k: any): any { try { const r = x.union(addAndDelete(x, other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_union_round_watched", "Set", "union", false, uSet_union_round_watched]);
function uSet_union_conditional_plain(x: any, k: any): any { const r = x.union((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["uSet_union_conditional_plain", "Set", "union", false, uSet_union_conditional_plain]);
function uSet_union_conditional_tail(x: any, k: any): any { return x.union((k ? note("yes", other) : note("no", undefined))); }
table.push(["uSet_union_conditional_tail", "Set", "union", false, uSet_union_conditional_tail]);
function uSet_union_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["uSet_union_conditional_loop", "Set", "union", false, uSet_union_conditional_loop]);
function uSet_union_conditional_watched(x: any, k: any): any { try { const r = x.union((k ? note("yes", other) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_union_conditional_watched", "Set", "union", false, uSet_union_conditional_watched]);
function uSet_union_throws_plain(x: any, k: any): any { const r = x.union(fail(other)); return [r]; }
table.push(["uSet_union_throws_plain", "Set", "union", false, uSet_union_throws_plain]);
function uSet_union_throws_tail(x: any, k: any): any { return x.union(fail(other)); }
table.push(["uSet_union_throws_tail", "Set", "union", false, uSet_union_throws_tail]);
function uSet_union_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(fail(other)); return [r]; }
table.push(["uSet_union_throws_loop", "Set", "union", false, uSet_union_throws_loop]);
function uSet_union_throws_watched(x: any, k: any): any { try { const r = x.union(fail(other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_union_throws_watched", "Set", "union", false, uSet_union_throws_watched]);
function uSet_isSubsetOf_call_plain(x: any, k: any): any { const r = x.isSubsetOf(note("argument", other)); return [r]; }
table.push(["uSet_isSubsetOf_call_plain", "Set", "isSubsetOf", false, uSet_isSubsetOf_call_plain]);
function uSet_isSubsetOf_call_tail(x: any, k: any): any { return x.isSubsetOf(note("argument", other)); }
table.push(["uSet_isSubsetOf_call_tail", "Set", "isSubsetOf", false, uSet_isSubsetOf_call_tail]);
function uSet_isSubsetOf_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(note("argument", other)); return [r]; }
table.push(["uSet_isSubsetOf_call_loop", "Set", "isSubsetOf", false, uSet_isSubsetOf_call_loop]);
function uSet_isSubsetOf_call_watched(x: any, k: any): any { try { const r = x.isSubsetOf(note("argument", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_isSubsetOf_call_watched", "Set", "isSubsetOf", false, uSet_isSubsetOf_call_watched]);
function uSet_isSubsetOf_getter_plain(x: any, k: any): any { const r = x.isSubsetOf(holder(other).value); return [r]; }
table.push(["uSet_isSubsetOf_getter_plain", "Set", "isSubsetOf", false, uSet_isSubsetOf_getter_plain]);
function uSet_isSubsetOf_getter_tail(x: any, k: any): any { return x.isSubsetOf(holder(other).value); }
table.push(["uSet_isSubsetOf_getter_tail", "Set", "isSubsetOf", false, uSet_isSubsetOf_getter_tail]);
function uSet_isSubsetOf_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(holder(other).value); return [r]; }
table.push(["uSet_isSubsetOf_getter_loop", "Set", "isSubsetOf", false, uSet_isSubsetOf_getter_loop]);
function uSet_isSubsetOf_getter_watched(x: any, k: any): any { try { const r = x.isSubsetOf(holder(other).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_isSubsetOf_getter_watched", "Set", "isSubsetOf", false, uSet_isSubsetOf_getter_watched]);
function uSet_isSubsetOf_own_plain(x: any, k: any): any { const r = x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); return [r]; }
table.push(["uSet_isSubsetOf_own_plain", "Set", "isSubsetOf", false, uSet_isSubsetOf_own_plain]);
function uSet_isSubsetOf_own_tail(x: any, k: any): any { return x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); }
table.push(["uSet_isSubsetOf_own_tail", "Set", "isSubsetOf", false, uSet_isSubsetOf_own_tail]);
function uSet_isSubsetOf_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); return [r]; }
table.push(["uSet_isSubsetOf_own_loop", "Set", "isSubsetOf", false, uSet_isSubsetOf_own_loop]);
function uSet_isSubsetOf_own_watched(x: any, k: any): any { try { const r = x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_isSubsetOf_own_watched", "Set", "isSubsetOf", false, uSet_isSubsetOf_own_watched]);
function uSet_isSubsetOf_prototype_plain(x: any, k: any): any { const r = x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); return [r]; }
table.push(["uSet_isSubsetOf_prototype_plain", "Set", "isSubsetOf", false, uSet_isSubsetOf_prototype_plain]);
function uSet_isSubsetOf_prototype_tail(x: any, k: any): any { return x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); }
table.push(["uSet_isSubsetOf_prototype_tail", "Set", "isSubsetOf", false, uSet_isSubsetOf_prototype_tail]);
function uSet_isSubsetOf_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); return [r]; }
table.push(["uSet_isSubsetOf_prototype_loop", "Set", "isSubsetOf", false, uSet_isSubsetOf_prototype_loop]);
function uSet_isSubsetOf_prototype_watched(x: any, k: any): any { try { const r = x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_isSubsetOf_prototype_watched", "Set", "isSubsetOf", false, uSet_isSubsetOf_prototype_watched]);
function uSet_isSubsetOf_round_plain(x: any, k: any): any { const r = x.isSubsetOf(addAndDelete(x, other)); return [r]; }
table.push(["uSet_isSubsetOf_round_plain", "Set", "isSubsetOf", false, uSet_isSubsetOf_round_plain]);
function uSet_isSubsetOf_round_tail(x: any, k: any): any { return x.isSubsetOf(addAndDelete(x, other)); }
table.push(["uSet_isSubsetOf_round_tail", "Set", "isSubsetOf", false, uSet_isSubsetOf_round_tail]);
function uSet_isSubsetOf_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(addAndDelete(x, other)); return [r]; }
table.push(["uSet_isSubsetOf_round_loop", "Set", "isSubsetOf", false, uSet_isSubsetOf_round_loop]);
function uSet_isSubsetOf_round_watched(x: any, k: any): any { try { const r = x.isSubsetOf(addAndDelete(x, other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_isSubsetOf_round_watched", "Set", "isSubsetOf", false, uSet_isSubsetOf_round_watched]);
function uSet_isSubsetOf_conditional_plain(x: any, k: any): any { const r = x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["uSet_isSubsetOf_conditional_plain", "Set", "isSubsetOf", false, uSet_isSubsetOf_conditional_plain]);
function uSet_isSubsetOf_conditional_tail(x: any, k: any): any { return x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); }
table.push(["uSet_isSubsetOf_conditional_tail", "Set", "isSubsetOf", false, uSet_isSubsetOf_conditional_tail]);
function uSet_isSubsetOf_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["uSet_isSubsetOf_conditional_loop", "Set", "isSubsetOf", false, uSet_isSubsetOf_conditional_loop]);
function uSet_isSubsetOf_conditional_watched(x: any, k: any): any { try { const r = x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_isSubsetOf_conditional_watched", "Set", "isSubsetOf", false, uSet_isSubsetOf_conditional_watched]);
function uSet_isSubsetOf_throws_plain(x: any, k: any): any { const r = x.isSubsetOf(fail(other)); return [r]; }
table.push(["uSet_isSubsetOf_throws_plain", "Set", "isSubsetOf", false, uSet_isSubsetOf_throws_plain]);
function uSet_isSubsetOf_throws_tail(x: any, k: any): any { return x.isSubsetOf(fail(other)); }
table.push(["uSet_isSubsetOf_throws_tail", "Set", "isSubsetOf", false, uSet_isSubsetOf_throws_tail]);
function uSet_isSubsetOf_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(fail(other)); return [r]; }
table.push(["uSet_isSubsetOf_throws_loop", "Set", "isSubsetOf", false, uSet_isSubsetOf_throws_loop]);
function uSet_isSubsetOf_throws_watched(x: any, k: any): any { try { const r = x.isSubsetOf(fail(other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uSet_isSubsetOf_throws_watched", "Set", "isSubsetOf", false, uSet_isSubsetOf_throws_watched]);
function uRegExp_test_call_plain(x: any, k: any): any { const r = x.test(note("argument", "abc")); return [r]; }
table.push(["uRegExp_test_call_plain", "RegExp", "test", false, uRegExp_test_call_plain]);
function uRegExp_test_call_tail(x: any, k: any): any { return x.test(note("argument", "abc")); }
table.push(["uRegExp_test_call_tail", "RegExp", "test", false, uRegExp_test_call_tail]);
function uRegExp_test_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.test(note("argument", "abc")); return [r]; }
table.push(["uRegExp_test_call_loop", "RegExp", "test", false, uRegExp_test_call_loop]);
function uRegExp_test_call_watched(x: any, k: any): any { try { const r = x.test(note("argument", "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_test_call_watched", "RegExp", "test", false, uRegExp_test_call_watched]);
function uRegExp_test_getter_plain(x: any, k: any): any { const r = x.test(holder("abc").value); return [r]; }
table.push(["uRegExp_test_getter_plain", "RegExp", "test", false, uRegExp_test_getter_plain]);
function uRegExp_test_getter_tail(x: any, k: any): any { return x.test(holder("abc").value); }
table.push(["uRegExp_test_getter_tail", "RegExp", "test", false, uRegExp_test_getter_tail]);
function uRegExp_test_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.test(holder("abc").value); return [r]; }
table.push(["uRegExp_test_getter_loop", "RegExp", "test", false, uRegExp_test_getter_loop]);
function uRegExp_test_getter_watched(x: any, k: any): any { try { const r = x.test(holder("abc").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_test_getter_watched", "RegExp", "test", false, uRegExp_test_getter_watched]);
function uRegExp_test_own_plain(x: any, k: any): any { const r = x.test(alterOwn(x, "test", "abc")); return [r]; }
table.push(["uRegExp_test_own_plain", "RegExp", "test", false, uRegExp_test_own_plain]);
function uRegExp_test_own_tail(x: any, k: any): any { return x.test(alterOwn(x, "test", "abc")); }
table.push(["uRegExp_test_own_tail", "RegExp", "test", false, uRegExp_test_own_tail]);
function uRegExp_test_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.test(alterOwn(x, "test", "abc")); return [r]; }
table.push(["uRegExp_test_own_loop", "RegExp", "test", false, uRegExp_test_own_loop]);
function uRegExp_test_own_watched(x: any, k: any): any { try { const r = x.test(alterOwn(x, "test", "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_test_own_watched", "RegExp", "test", false, uRegExp_test_own_watched]);
function uRegExp_test_prototype_plain(x: any, k: any): any { const r = x.test(alterPrototype(x, "test", "abc")); return [r]; }
table.push(["uRegExp_test_prototype_plain", "RegExp", "test", false, uRegExp_test_prototype_plain]);
function uRegExp_test_prototype_tail(x: any, k: any): any { return x.test(alterPrototype(x, "test", "abc")); }
table.push(["uRegExp_test_prototype_tail", "RegExp", "test", false, uRegExp_test_prototype_tail]);
function uRegExp_test_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.test(alterPrototype(x, "test", "abc")); return [r]; }
table.push(["uRegExp_test_prototype_loop", "RegExp", "test", false, uRegExp_test_prototype_loop]);
function uRegExp_test_prototype_watched(x: any, k: any): any { try { const r = x.test(alterPrototype(x, "test", "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_test_prototype_watched", "RegExp", "test", false, uRegExp_test_prototype_watched]);
function uRegExp_test_round_plain(x: any, k: any): any { const r = x.test(addAndDelete(x, "abc")); return [r]; }
table.push(["uRegExp_test_round_plain", "RegExp", "test", false, uRegExp_test_round_plain]);
function uRegExp_test_round_tail(x: any, k: any): any { return x.test(addAndDelete(x, "abc")); }
table.push(["uRegExp_test_round_tail", "RegExp", "test", false, uRegExp_test_round_tail]);
function uRegExp_test_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.test(addAndDelete(x, "abc")); return [r]; }
table.push(["uRegExp_test_round_loop", "RegExp", "test", false, uRegExp_test_round_loop]);
function uRegExp_test_round_watched(x: any, k: any): any { try { const r = x.test(addAndDelete(x, "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_test_round_watched", "RegExp", "test", false, uRegExp_test_round_watched]);
function uRegExp_test_conditional_plain(x: any, k: any): any { const r = x.test((k ? note("yes", "abc") : note("no", undefined))); return [r]; }
table.push(["uRegExp_test_conditional_plain", "RegExp", "test", false, uRegExp_test_conditional_plain]);
function uRegExp_test_conditional_tail(x: any, k: any): any { return x.test((k ? note("yes", "abc") : note("no", undefined))); }
table.push(["uRegExp_test_conditional_tail", "RegExp", "test", false, uRegExp_test_conditional_tail]);
function uRegExp_test_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.test((k ? note("yes", "abc") : note("no", undefined))); return [r]; }
table.push(["uRegExp_test_conditional_loop", "RegExp", "test", false, uRegExp_test_conditional_loop]);
function uRegExp_test_conditional_watched(x: any, k: any): any { try { const r = x.test((k ? note("yes", "abc") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_test_conditional_watched", "RegExp", "test", false, uRegExp_test_conditional_watched]);
function uRegExp_test_throws_plain(x: any, k: any): any { const r = x.test(fail("abc")); return [r]; }
table.push(["uRegExp_test_throws_plain", "RegExp", "test", false, uRegExp_test_throws_plain]);
function uRegExp_test_throws_tail(x: any, k: any): any { return x.test(fail("abc")); }
table.push(["uRegExp_test_throws_tail", "RegExp", "test", false, uRegExp_test_throws_tail]);
function uRegExp_test_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.test(fail("abc")); return [r]; }
table.push(["uRegExp_test_throws_loop", "RegExp", "test", false, uRegExp_test_throws_loop]);
function uRegExp_test_throws_watched(x: any, k: any): any { try { const r = x.test(fail("abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_test_throws_watched", "RegExp", "test", false, uRegExp_test_throws_watched]);
function uRegExp_exec_call_plain(x: any, k: any): any { const r = x.exec(note("argument", "abc")); return [r]; }
table.push(["uRegExp_exec_call_plain", "RegExp", "exec", false, uRegExp_exec_call_plain]);
function uRegExp_exec_call_tail(x: any, k: any): any { return x.exec(note("argument", "abc")); }
table.push(["uRegExp_exec_call_tail", "RegExp", "exec", false, uRegExp_exec_call_tail]);
function uRegExp_exec_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.exec(note("argument", "abc")); return [r]; }
table.push(["uRegExp_exec_call_loop", "RegExp", "exec", false, uRegExp_exec_call_loop]);
function uRegExp_exec_call_watched(x: any, k: any): any { try { const r = x.exec(note("argument", "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_exec_call_watched", "RegExp", "exec", false, uRegExp_exec_call_watched]);
function uRegExp_exec_getter_plain(x: any, k: any): any { const r = x.exec(holder("abc").value); return [r]; }
table.push(["uRegExp_exec_getter_plain", "RegExp", "exec", false, uRegExp_exec_getter_plain]);
function uRegExp_exec_getter_tail(x: any, k: any): any { return x.exec(holder("abc").value); }
table.push(["uRegExp_exec_getter_tail", "RegExp", "exec", false, uRegExp_exec_getter_tail]);
function uRegExp_exec_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.exec(holder("abc").value); return [r]; }
table.push(["uRegExp_exec_getter_loop", "RegExp", "exec", false, uRegExp_exec_getter_loop]);
function uRegExp_exec_getter_watched(x: any, k: any): any { try { const r = x.exec(holder("abc").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_exec_getter_watched", "RegExp", "exec", false, uRegExp_exec_getter_watched]);
function uRegExp_exec_own_plain(x: any, k: any): any { const r = x.exec(alterOwn(x, "exec", "abc")); return [r]; }
table.push(["uRegExp_exec_own_plain", "RegExp", "exec", false, uRegExp_exec_own_plain]);
function uRegExp_exec_own_tail(x: any, k: any): any { return x.exec(alterOwn(x, "exec", "abc")); }
table.push(["uRegExp_exec_own_tail", "RegExp", "exec", false, uRegExp_exec_own_tail]);
function uRegExp_exec_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.exec(alterOwn(x, "exec", "abc")); return [r]; }
table.push(["uRegExp_exec_own_loop", "RegExp", "exec", false, uRegExp_exec_own_loop]);
function uRegExp_exec_own_watched(x: any, k: any): any { try { const r = x.exec(alterOwn(x, "exec", "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_exec_own_watched", "RegExp", "exec", false, uRegExp_exec_own_watched]);
function uRegExp_exec_prototype_plain(x: any, k: any): any { const r = x.exec(alterPrototype(x, "exec", "abc")); return [r]; }
table.push(["uRegExp_exec_prototype_plain", "RegExp", "exec", false, uRegExp_exec_prototype_plain]);
function uRegExp_exec_prototype_tail(x: any, k: any): any { return x.exec(alterPrototype(x, "exec", "abc")); }
table.push(["uRegExp_exec_prototype_tail", "RegExp", "exec", false, uRegExp_exec_prototype_tail]);
function uRegExp_exec_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.exec(alterPrototype(x, "exec", "abc")); return [r]; }
table.push(["uRegExp_exec_prototype_loop", "RegExp", "exec", false, uRegExp_exec_prototype_loop]);
function uRegExp_exec_prototype_watched(x: any, k: any): any { try { const r = x.exec(alterPrototype(x, "exec", "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_exec_prototype_watched", "RegExp", "exec", false, uRegExp_exec_prototype_watched]);
function uRegExp_exec_round_plain(x: any, k: any): any { const r = x.exec(addAndDelete(x, "abc")); return [r]; }
table.push(["uRegExp_exec_round_plain", "RegExp", "exec", false, uRegExp_exec_round_plain]);
function uRegExp_exec_round_tail(x: any, k: any): any { return x.exec(addAndDelete(x, "abc")); }
table.push(["uRegExp_exec_round_tail", "RegExp", "exec", false, uRegExp_exec_round_tail]);
function uRegExp_exec_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.exec(addAndDelete(x, "abc")); return [r]; }
table.push(["uRegExp_exec_round_loop", "RegExp", "exec", false, uRegExp_exec_round_loop]);
function uRegExp_exec_round_watched(x: any, k: any): any { try { const r = x.exec(addAndDelete(x, "abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_exec_round_watched", "RegExp", "exec", false, uRegExp_exec_round_watched]);
function uRegExp_exec_conditional_plain(x: any, k: any): any { const r = x.exec((k ? note("yes", "abc") : note("no", undefined))); return [r]; }
table.push(["uRegExp_exec_conditional_plain", "RegExp", "exec", false, uRegExp_exec_conditional_plain]);
function uRegExp_exec_conditional_tail(x: any, k: any): any { return x.exec((k ? note("yes", "abc") : note("no", undefined))); }
table.push(["uRegExp_exec_conditional_tail", "RegExp", "exec", false, uRegExp_exec_conditional_tail]);
function uRegExp_exec_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.exec((k ? note("yes", "abc") : note("no", undefined))); return [r]; }
table.push(["uRegExp_exec_conditional_loop", "RegExp", "exec", false, uRegExp_exec_conditional_loop]);
function uRegExp_exec_conditional_watched(x: any, k: any): any { try { const r = x.exec((k ? note("yes", "abc") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_exec_conditional_watched", "RegExp", "exec", false, uRegExp_exec_conditional_watched]);
function uRegExp_exec_throws_plain(x: any, k: any): any { const r = x.exec(fail("abc")); return [r]; }
table.push(["uRegExp_exec_throws_plain", "RegExp", "exec", false, uRegExp_exec_throws_plain]);
function uRegExp_exec_throws_tail(x: any, k: any): any { return x.exec(fail("abc")); }
table.push(["uRegExp_exec_throws_tail", "RegExp", "exec", false, uRegExp_exec_throws_tail]);
function uRegExp_exec_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.exec(fail("abc")); return [r]; }
table.push(["uRegExp_exec_throws_loop", "RegExp", "exec", false, uRegExp_exec_throws_loop]);
function uRegExp_exec_throws_watched(x: any, k: any): any { try { const r = x.exec(fail("abc")); return [r]; } catch (e) { return thrown(e); } }
table.push(["uRegExp_exec_throws_watched", "RegExp", "exec", false, uRegExp_exec_throws_watched]);
function uPromise_then_call_plain(x: any, k: any): any { const r = x.then(note("argument", identity)); return [r]; }
table.push(["uPromise_then_call_plain", "Promise", "then", false, uPromise_then_call_plain]);
function uPromise_then_call_tail(x: any, k: any): any { return x.then(note("argument", identity)); }
table.push(["uPromise_then_call_tail", "Promise", "then", false, uPromise_then_call_tail]);
function uPromise_then_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.then(note("argument", identity)); return [r]; }
table.push(["uPromise_then_call_loop", "Promise", "then", false, uPromise_then_call_loop]);
function uPromise_then_call_watched(x: any, k: any): any { try { const r = x.then(note("argument", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_then_call_watched", "Promise", "then", false, uPromise_then_call_watched]);
function uPromise_then_getter_plain(x: any, k: any): any { const r = x.then(holder(identity).value); return [r]; }
table.push(["uPromise_then_getter_plain", "Promise", "then", false, uPromise_then_getter_plain]);
function uPromise_then_getter_tail(x: any, k: any): any { return x.then(holder(identity).value); }
table.push(["uPromise_then_getter_tail", "Promise", "then", false, uPromise_then_getter_tail]);
function uPromise_then_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.then(holder(identity).value); return [r]; }
table.push(["uPromise_then_getter_loop", "Promise", "then", false, uPromise_then_getter_loop]);
function uPromise_then_getter_watched(x: any, k: any): any { try { const r = x.then(holder(identity).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_then_getter_watched", "Promise", "then", false, uPromise_then_getter_watched]);
function uPromise_then_own_plain(x: any, k: any): any { const r = x.then(alterOwn(x, "then", identity)); return [r]; }
table.push(["uPromise_then_own_plain", "Promise", "then", false, uPromise_then_own_plain]);
function uPromise_then_own_tail(x: any, k: any): any { return x.then(alterOwn(x, "then", identity)); }
table.push(["uPromise_then_own_tail", "Promise", "then", false, uPromise_then_own_tail]);
function uPromise_then_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.then(alterOwn(x, "then", identity)); return [r]; }
table.push(["uPromise_then_own_loop", "Promise", "then", false, uPromise_then_own_loop]);
function uPromise_then_own_watched(x: any, k: any): any { try { const r = x.then(alterOwn(x, "then", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_then_own_watched", "Promise", "then", false, uPromise_then_own_watched]);
function uPromise_then_prototype_plain(x: any, k: any): any { const r = x.then(alterPrototype(x, "then", identity)); return [r]; }
table.push(["uPromise_then_prototype_plain", "Promise", "then", false, uPromise_then_prototype_plain]);
function uPromise_then_prototype_tail(x: any, k: any): any { return x.then(alterPrototype(x, "then", identity)); }
table.push(["uPromise_then_prototype_tail", "Promise", "then", false, uPromise_then_prototype_tail]);
function uPromise_then_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.then(alterPrototype(x, "then", identity)); return [r]; }
table.push(["uPromise_then_prototype_loop", "Promise", "then", false, uPromise_then_prototype_loop]);
function uPromise_then_prototype_watched(x: any, k: any): any { try { const r = x.then(alterPrototype(x, "then", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_then_prototype_watched", "Promise", "then", false, uPromise_then_prototype_watched]);
function uPromise_then_round_plain(x: any, k: any): any { const r = x.then(addAndDelete(x, identity)); return [r]; }
table.push(["uPromise_then_round_plain", "Promise", "then", false, uPromise_then_round_plain]);
function uPromise_then_round_tail(x: any, k: any): any { return x.then(addAndDelete(x, identity)); }
table.push(["uPromise_then_round_tail", "Promise", "then", false, uPromise_then_round_tail]);
function uPromise_then_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.then(addAndDelete(x, identity)); return [r]; }
table.push(["uPromise_then_round_loop", "Promise", "then", false, uPromise_then_round_loop]);
function uPromise_then_round_watched(x: any, k: any): any { try { const r = x.then(addAndDelete(x, identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_then_round_watched", "Promise", "then", false, uPromise_then_round_watched]);
function uPromise_then_conditional_plain(x: any, k: any): any { const r = x.then((k ? note("yes", identity) : note("no", undefined))); return [r]; }
table.push(["uPromise_then_conditional_plain", "Promise", "then", false, uPromise_then_conditional_plain]);
function uPromise_then_conditional_tail(x: any, k: any): any { return x.then((k ? note("yes", identity) : note("no", undefined))); }
table.push(["uPromise_then_conditional_tail", "Promise", "then", false, uPromise_then_conditional_tail]);
function uPromise_then_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.then((k ? note("yes", identity) : note("no", undefined))); return [r]; }
table.push(["uPromise_then_conditional_loop", "Promise", "then", false, uPromise_then_conditional_loop]);
function uPromise_then_conditional_watched(x: any, k: any): any { try { const r = x.then((k ? note("yes", identity) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_then_conditional_watched", "Promise", "then", false, uPromise_then_conditional_watched]);
function uPromise_then_throws_plain(x: any, k: any): any { const r = x.then(fail(identity)); return [r]; }
table.push(["uPromise_then_throws_plain", "Promise", "then", false, uPromise_then_throws_plain]);
function uPromise_then_throws_tail(x: any, k: any): any { return x.then(fail(identity)); }
table.push(["uPromise_then_throws_tail", "Promise", "then", false, uPromise_then_throws_tail]);
function uPromise_then_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.then(fail(identity)); return [r]; }
table.push(["uPromise_then_throws_loop", "Promise", "then", false, uPromise_then_throws_loop]);
function uPromise_then_throws_watched(x: any, k: any): any { try { const r = x.then(fail(identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_then_throws_watched", "Promise", "then", false, uPromise_then_throws_watched]);
function uPromise_catch_call_plain(x: any, k: any): any { const r = x.catch(note("argument", identity)); return [r]; }
table.push(["uPromise_catch_call_plain", "Promise", "catch", false, uPromise_catch_call_plain]);
function uPromise_catch_call_tail(x: any, k: any): any { return x.catch(note("argument", identity)); }
table.push(["uPromise_catch_call_tail", "Promise", "catch", false, uPromise_catch_call_tail]);
function uPromise_catch_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.catch(note("argument", identity)); return [r]; }
table.push(["uPromise_catch_call_loop", "Promise", "catch", false, uPromise_catch_call_loop]);
function uPromise_catch_call_watched(x: any, k: any): any { try { const r = x.catch(note("argument", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_catch_call_watched", "Promise", "catch", false, uPromise_catch_call_watched]);
function uPromise_catch_getter_plain(x: any, k: any): any { const r = x.catch(holder(identity).value); return [r]; }
table.push(["uPromise_catch_getter_plain", "Promise", "catch", false, uPromise_catch_getter_plain]);
function uPromise_catch_getter_tail(x: any, k: any): any { return x.catch(holder(identity).value); }
table.push(["uPromise_catch_getter_tail", "Promise", "catch", false, uPromise_catch_getter_tail]);
function uPromise_catch_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.catch(holder(identity).value); return [r]; }
table.push(["uPromise_catch_getter_loop", "Promise", "catch", false, uPromise_catch_getter_loop]);
function uPromise_catch_getter_watched(x: any, k: any): any { try { const r = x.catch(holder(identity).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_catch_getter_watched", "Promise", "catch", false, uPromise_catch_getter_watched]);
function uPromise_catch_own_plain(x: any, k: any): any { const r = x.catch(alterOwn(x, "catch", identity)); return [r]; }
table.push(["uPromise_catch_own_plain", "Promise", "catch", false, uPromise_catch_own_plain]);
function uPromise_catch_own_tail(x: any, k: any): any { return x.catch(alterOwn(x, "catch", identity)); }
table.push(["uPromise_catch_own_tail", "Promise", "catch", false, uPromise_catch_own_tail]);
function uPromise_catch_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.catch(alterOwn(x, "catch", identity)); return [r]; }
table.push(["uPromise_catch_own_loop", "Promise", "catch", false, uPromise_catch_own_loop]);
function uPromise_catch_own_watched(x: any, k: any): any { try { const r = x.catch(alterOwn(x, "catch", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_catch_own_watched", "Promise", "catch", false, uPromise_catch_own_watched]);
function uPromise_catch_prototype_plain(x: any, k: any): any { const r = x.catch(alterPrototype(x, "catch", identity)); return [r]; }
table.push(["uPromise_catch_prototype_plain", "Promise", "catch", false, uPromise_catch_prototype_plain]);
function uPromise_catch_prototype_tail(x: any, k: any): any { return x.catch(alterPrototype(x, "catch", identity)); }
table.push(["uPromise_catch_prototype_tail", "Promise", "catch", false, uPromise_catch_prototype_tail]);
function uPromise_catch_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.catch(alterPrototype(x, "catch", identity)); return [r]; }
table.push(["uPromise_catch_prototype_loop", "Promise", "catch", false, uPromise_catch_prototype_loop]);
function uPromise_catch_prototype_watched(x: any, k: any): any { try { const r = x.catch(alterPrototype(x, "catch", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_catch_prototype_watched", "Promise", "catch", false, uPromise_catch_prototype_watched]);
function uPromise_catch_round_plain(x: any, k: any): any { const r = x.catch(addAndDelete(x, identity)); return [r]; }
table.push(["uPromise_catch_round_plain", "Promise", "catch", false, uPromise_catch_round_plain]);
function uPromise_catch_round_tail(x: any, k: any): any { return x.catch(addAndDelete(x, identity)); }
table.push(["uPromise_catch_round_tail", "Promise", "catch", false, uPromise_catch_round_tail]);
function uPromise_catch_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.catch(addAndDelete(x, identity)); return [r]; }
table.push(["uPromise_catch_round_loop", "Promise", "catch", false, uPromise_catch_round_loop]);
function uPromise_catch_round_watched(x: any, k: any): any { try { const r = x.catch(addAndDelete(x, identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_catch_round_watched", "Promise", "catch", false, uPromise_catch_round_watched]);
function uPromise_catch_conditional_plain(x: any, k: any): any { const r = x.catch((k ? note("yes", identity) : note("no", undefined))); return [r]; }
table.push(["uPromise_catch_conditional_plain", "Promise", "catch", false, uPromise_catch_conditional_plain]);
function uPromise_catch_conditional_tail(x: any, k: any): any { return x.catch((k ? note("yes", identity) : note("no", undefined))); }
table.push(["uPromise_catch_conditional_tail", "Promise", "catch", false, uPromise_catch_conditional_tail]);
function uPromise_catch_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.catch((k ? note("yes", identity) : note("no", undefined))); return [r]; }
table.push(["uPromise_catch_conditional_loop", "Promise", "catch", false, uPromise_catch_conditional_loop]);
function uPromise_catch_conditional_watched(x: any, k: any): any { try { const r = x.catch((k ? note("yes", identity) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_catch_conditional_watched", "Promise", "catch", false, uPromise_catch_conditional_watched]);
function uPromise_catch_throws_plain(x: any, k: any): any { const r = x.catch(fail(identity)); return [r]; }
table.push(["uPromise_catch_throws_plain", "Promise", "catch", false, uPromise_catch_throws_plain]);
function uPromise_catch_throws_tail(x: any, k: any): any { return x.catch(fail(identity)); }
table.push(["uPromise_catch_throws_tail", "Promise", "catch", false, uPromise_catch_throws_tail]);
function uPromise_catch_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.catch(fail(identity)); return [r]; }
table.push(["uPromise_catch_throws_loop", "Promise", "catch", false, uPromise_catch_throws_loop]);
function uPromise_catch_throws_watched(x: any, k: any): any { try { const r = x.catch(fail(identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_catch_throws_watched", "Promise", "catch", false, uPromise_catch_throws_watched]);
function uPromise_finally_call_plain(x: any, k: any): any { const r = x.finally(note("argument", identity)); return [r]; }
table.push(["uPromise_finally_call_plain", "Promise", "finally", false, uPromise_finally_call_plain]);
function uPromise_finally_call_tail(x: any, k: any): any { return x.finally(note("argument", identity)); }
table.push(["uPromise_finally_call_tail", "Promise", "finally", false, uPromise_finally_call_tail]);
function uPromise_finally_call_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.finally(note("argument", identity)); return [r]; }
table.push(["uPromise_finally_call_loop", "Promise", "finally", false, uPromise_finally_call_loop]);
function uPromise_finally_call_watched(x: any, k: any): any { try { const r = x.finally(note("argument", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_finally_call_watched", "Promise", "finally", false, uPromise_finally_call_watched]);
function uPromise_finally_getter_plain(x: any, k: any): any { const r = x.finally(holder(identity).value); return [r]; }
table.push(["uPromise_finally_getter_plain", "Promise", "finally", false, uPromise_finally_getter_plain]);
function uPromise_finally_getter_tail(x: any, k: any): any { return x.finally(holder(identity).value); }
table.push(["uPromise_finally_getter_tail", "Promise", "finally", false, uPromise_finally_getter_tail]);
function uPromise_finally_getter_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.finally(holder(identity).value); return [r]; }
table.push(["uPromise_finally_getter_loop", "Promise", "finally", false, uPromise_finally_getter_loop]);
function uPromise_finally_getter_watched(x: any, k: any): any { try { const r = x.finally(holder(identity).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_finally_getter_watched", "Promise", "finally", false, uPromise_finally_getter_watched]);
function uPromise_finally_own_plain(x: any, k: any): any { const r = x.finally(alterOwn(x, "finally", identity)); return [r]; }
table.push(["uPromise_finally_own_plain", "Promise", "finally", false, uPromise_finally_own_plain]);
function uPromise_finally_own_tail(x: any, k: any): any { return x.finally(alterOwn(x, "finally", identity)); }
table.push(["uPromise_finally_own_tail", "Promise", "finally", false, uPromise_finally_own_tail]);
function uPromise_finally_own_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.finally(alterOwn(x, "finally", identity)); return [r]; }
table.push(["uPromise_finally_own_loop", "Promise", "finally", false, uPromise_finally_own_loop]);
function uPromise_finally_own_watched(x: any, k: any): any { try { const r = x.finally(alterOwn(x, "finally", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_finally_own_watched", "Promise", "finally", false, uPromise_finally_own_watched]);
function uPromise_finally_prototype_plain(x: any, k: any): any { const r = x.finally(alterPrototype(x, "finally", identity)); return [r]; }
table.push(["uPromise_finally_prototype_plain", "Promise", "finally", false, uPromise_finally_prototype_plain]);
function uPromise_finally_prototype_tail(x: any, k: any): any { return x.finally(alterPrototype(x, "finally", identity)); }
table.push(["uPromise_finally_prototype_tail", "Promise", "finally", false, uPromise_finally_prototype_tail]);
function uPromise_finally_prototype_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.finally(alterPrototype(x, "finally", identity)); return [r]; }
table.push(["uPromise_finally_prototype_loop", "Promise", "finally", false, uPromise_finally_prototype_loop]);
function uPromise_finally_prototype_watched(x: any, k: any): any { try { const r = x.finally(alterPrototype(x, "finally", identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_finally_prototype_watched", "Promise", "finally", false, uPromise_finally_prototype_watched]);
function uPromise_finally_round_plain(x: any, k: any): any { const r = x.finally(addAndDelete(x, identity)); return [r]; }
table.push(["uPromise_finally_round_plain", "Promise", "finally", false, uPromise_finally_round_plain]);
function uPromise_finally_round_tail(x: any, k: any): any { return x.finally(addAndDelete(x, identity)); }
table.push(["uPromise_finally_round_tail", "Promise", "finally", false, uPromise_finally_round_tail]);
function uPromise_finally_round_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.finally(addAndDelete(x, identity)); return [r]; }
table.push(["uPromise_finally_round_loop", "Promise", "finally", false, uPromise_finally_round_loop]);
function uPromise_finally_round_watched(x: any, k: any): any { try { const r = x.finally(addAndDelete(x, identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_finally_round_watched", "Promise", "finally", false, uPromise_finally_round_watched]);
function uPromise_finally_conditional_plain(x: any, k: any): any { const r = x.finally((k ? note("yes", identity) : note("no", undefined))); return [r]; }
table.push(["uPromise_finally_conditional_plain", "Promise", "finally", false, uPromise_finally_conditional_plain]);
function uPromise_finally_conditional_tail(x: any, k: any): any { return x.finally((k ? note("yes", identity) : note("no", undefined))); }
table.push(["uPromise_finally_conditional_tail", "Promise", "finally", false, uPromise_finally_conditional_tail]);
function uPromise_finally_conditional_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.finally((k ? note("yes", identity) : note("no", undefined))); return [r]; }
table.push(["uPromise_finally_conditional_loop", "Promise", "finally", false, uPromise_finally_conditional_loop]);
function uPromise_finally_conditional_watched(x: any, k: any): any { try { const r = x.finally((k ? note("yes", identity) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_finally_conditional_watched", "Promise", "finally", false, uPromise_finally_conditional_watched]);
function uPromise_finally_throws_plain(x: any, k: any): any { const r = x.finally(fail(identity)); return [r]; }
table.push(["uPromise_finally_throws_plain", "Promise", "finally", false, uPromise_finally_throws_plain]);
function uPromise_finally_throws_tail(x: any, k: any): any { return x.finally(fail(identity)); }
table.push(["uPromise_finally_throws_tail", "Promise", "finally", false, uPromise_finally_throws_tail]);
function uPromise_finally_throws_loop(x: any, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.finally(fail(identity)); return [r]; }
table.push(["uPromise_finally_throws_loop", "Promise", "finally", false, uPromise_finally_throws_loop]);
function uPromise_finally_throws_watched(x: any, k: any): any { try { const r = x.finally(fail(identity)); return [r]; } catch (e) { return thrown(e); } }
table.push(["uPromise_finally_throws_watched", "Promise", "finally", false, uPromise_finally_throws_watched]);
function tArray_slice_call_plain(x: number[], k: any): any { const r = x.slice(note("argument", 1)); return [r]; }
table.push(["tArray_slice_call_plain", "Array", "slice", true, tArray_slice_call_plain]);
function tArray_slice_call_tail(x: number[], k: any): any { return x.slice(note("argument", 1)); }
table.push(["tArray_slice_call_tail", "Array", "slice", true, tArray_slice_call_tail]);
function tArray_slice_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(note("argument", 1)); return [r]; }
table.push(["tArray_slice_call_loop", "Array", "slice", true, tArray_slice_call_loop]);
function tArray_slice_call_watched(x: number[], k: any): any { try { const r = x.slice(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_slice_call_watched", "Array", "slice", true, tArray_slice_call_watched]);
function tArray_slice_getter_plain(x: number[], k: any): any { const r = x.slice(holder(1).value); return [r]; }
table.push(["tArray_slice_getter_plain", "Array", "slice", true, tArray_slice_getter_plain]);
function tArray_slice_getter_tail(x: number[], k: any): any { return x.slice(holder(1).value); }
table.push(["tArray_slice_getter_tail", "Array", "slice", true, tArray_slice_getter_tail]);
function tArray_slice_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(holder(1).value); return [r]; }
table.push(["tArray_slice_getter_loop", "Array", "slice", true, tArray_slice_getter_loop]);
function tArray_slice_getter_watched(x: number[], k: any): any { try { const r = x.slice(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_slice_getter_watched", "Array", "slice", true, tArray_slice_getter_watched]);
function tArray_slice_own_plain(x: number[], k: any): any { const r = x.slice(alterOwn(x, "slice", 1)); return [r]; }
table.push(["tArray_slice_own_plain", "Array", "slice", true, tArray_slice_own_plain]);
function tArray_slice_own_tail(x: number[], k: any): any { return x.slice(alterOwn(x, "slice", 1)); }
table.push(["tArray_slice_own_tail", "Array", "slice", true, tArray_slice_own_tail]);
function tArray_slice_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(alterOwn(x, "slice", 1)); return [r]; }
table.push(["tArray_slice_own_loop", "Array", "slice", true, tArray_slice_own_loop]);
function tArray_slice_own_watched(x: number[], k: any): any { try { const r = x.slice(alterOwn(x, "slice", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_slice_own_watched", "Array", "slice", true, tArray_slice_own_watched]);
function tArray_slice_prototype_plain(x: number[], k: any): any { const r = x.slice(alterPrototype(x, "slice", 1)); return [r]; }
table.push(["tArray_slice_prototype_plain", "Array", "slice", true, tArray_slice_prototype_plain]);
function tArray_slice_prototype_tail(x: number[], k: any): any { return x.slice(alterPrototype(x, "slice", 1)); }
table.push(["tArray_slice_prototype_tail", "Array", "slice", true, tArray_slice_prototype_tail]);
function tArray_slice_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(alterPrototype(x, "slice", 1)); return [r]; }
table.push(["tArray_slice_prototype_loop", "Array", "slice", true, tArray_slice_prototype_loop]);
function tArray_slice_prototype_watched(x: number[], k: any): any { try { const r = x.slice(alterPrototype(x, "slice", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_slice_prototype_watched", "Array", "slice", true, tArray_slice_prototype_watched]);
function tArray_slice_round_plain(x: number[], k: any): any { const r = x.slice(addAndDelete(x, 1)); return [r]; }
table.push(["tArray_slice_round_plain", "Array", "slice", true, tArray_slice_round_plain]);
function tArray_slice_round_tail(x: number[], k: any): any { return x.slice(addAndDelete(x, 1)); }
table.push(["tArray_slice_round_tail", "Array", "slice", true, tArray_slice_round_tail]);
function tArray_slice_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(addAndDelete(x, 1)); return [r]; }
table.push(["tArray_slice_round_loop", "Array", "slice", true, tArray_slice_round_loop]);
function tArray_slice_round_watched(x: number[], k: any): any { try { const r = x.slice(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_slice_round_watched", "Array", "slice", true, tArray_slice_round_watched]);
function tArray_slice_conditional_plain(x: number[], k: any): any { const r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["tArray_slice_conditional_plain", "Array", "slice", true, tArray_slice_conditional_plain]);
function tArray_slice_conditional_tail(x: number[], k: any): any { return x.slice((k ? note("yes", 1) : note("no", undefined))); }
table.push(["tArray_slice_conditional_tail", "Array", "slice", true, tArray_slice_conditional_tail]);
function tArray_slice_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["tArray_slice_conditional_loop", "Array", "slice", true, tArray_slice_conditional_loop]);
function tArray_slice_conditional_watched(x: number[], k: any): any { try { const r = x.slice((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_slice_conditional_watched", "Array", "slice", true, tArray_slice_conditional_watched]);
function tArray_slice_throws_plain(x: number[], k: any): any { const r = x.slice(fail(1)); return [r]; }
table.push(["tArray_slice_throws_plain", "Array", "slice", true, tArray_slice_throws_plain]);
function tArray_slice_throws_tail(x: number[], k: any): any { return x.slice(fail(1)); }
table.push(["tArray_slice_throws_tail", "Array", "slice", true, tArray_slice_throws_tail]);
function tArray_slice_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.slice(fail(1)); return [r]; }
table.push(["tArray_slice_throws_loop", "Array", "slice", true, tArray_slice_throws_loop]);
function tArray_slice_throws_watched(x: number[], k: any): any { try { const r = x.slice(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_slice_throws_watched", "Array", "slice", true, tArray_slice_throws_watched]);
function tArray_indexOf_call_plain(x: number[], k: any): any { const r = x.indexOf(note("argument", 2)); return [r]; }
table.push(["tArray_indexOf_call_plain", "Array", "indexOf", true, tArray_indexOf_call_plain]);
function tArray_indexOf_call_tail(x: number[], k: any): any { return x.indexOf(note("argument", 2)); }
table.push(["tArray_indexOf_call_tail", "Array", "indexOf", true, tArray_indexOf_call_tail]);
function tArray_indexOf_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(note("argument", 2)); return [r]; }
table.push(["tArray_indexOf_call_loop", "Array", "indexOf", true, tArray_indexOf_call_loop]);
function tArray_indexOf_call_watched(x: number[], k: any): any { try { const r = x.indexOf(note("argument", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_indexOf_call_watched", "Array", "indexOf", true, tArray_indexOf_call_watched]);
function tArray_indexOf_getter_plain(x: number[], k: any): any { const r = x.indexOf(holder(2).value); return [r]; }
table.push(["tArray_indexOf_getter_plain", "Array", "indexOf", true, tArray_indexOf_getter_plain]);
function tArray_indexOf_getter_tail(x: number[], k: any): any { return x.indexOf(holder(2).value); }
table.push(["tArray_indexOf_getter_tail", "Array", "indexOf", true, tArray_indexOf_getter_tail]);
function tArray_indexOf_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(holder(2).value); return [r]; }
table.push(["tArray_indexOf_getter_loop", "Array", "indexOf", true, tArray_indexOf_getter_loop]);
function tArray_indexOf_getter_watched(x: number[], k: any): any { try { const r = x.indexOf(holder(2).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_indexOf_getter_watched", "Array", "indexOf", true, tArray_indexOf_getter_watched]);
function tArray_indexOf_own_plain(x: number[], k: any): any { const r = x.indexOf(alterOwn(x, "indexOf", 2)); return [r]; }
table.push(["tArray_indexOf_own_plain", "Array", "indexOf", true, tArray_indexOf_own_plain]);
function tArray_indexOf_own_tail(x: number[], k: any): any { return x.indexOf(alterOwn(x, "indexOf", 2)); }
table.push(["tArray_indexOf_own_tail", "Array", "indexOf", true, tArray_indexOf_own_tail]);
function tArray_indexOf_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(alterOwn(x, "indexOf", 2)); return [r]; }
table.push(["tArray_indexOf_own_loop", "Array", "indexOf", true, tArray_indexOf_own_loop]);
function tArray_indexOf_own_watched(x: number[], k: any): any { try { const r = x.indexOf(alterOwn(x, "indexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_indexOf_own_watched", "Array", "indexOf", true, tArray_indexOf_own_watched]);
function tArray_indexOf_prototype_plain(x: number[], k: any): any { const r = x.indexOf(alterPrototype(x, "indexOf", 2)); return [r]; }
table.push(["tArray_indexOf_prototype_plain", "Array", "indexOf", true, tArray_indexOf_prototype_plain]);
function tArray_indexOf_prototype_tail(x: number[], k: any): any { return x.indexOf(alterPrototype(x, "indexOf", 2)); }
table.push(["tArray_indexOf_prototype_tail", "Array", "indexOf", true, tArray_indexOf_prototype_tail]);
function tArray_indexOf_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(alterPrototype(x, "indexOf", 2)); return [r]; }
table.push(["tArray_indexOf_prototype_loop", "Array", "indexOf", true, tArray_indexOf_prototype_loop]);
function tArray_indexOf_prototype_watched(x: number[], k: any): any { try { const r = x.indexOf(alterPrototype(x, "indexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_indexOf_prototype_watched", "Array", "indexOf", true, tArray_indexOf_prototype_watched]);
function tArray_indexOf_round_plain(x: number[], k: any): any { const r = x.indexOf(addAndDelete(x, 2)); return [r]; }
table.push(["tArray_indexOf_round_plain", "Array", "indexOf", true, tArray_indexOf_round_plain]);
function tArray_indexOf_round_tail(x: number[], k: any): any { return x.indexOf(addAndDelete(x, 2)); }
table.push(["tArray_indexOf_round_tail", "Array", "indexOf", true, tArray_indexOf_round_tail]);
function tArray_indexOf_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(addAndDelete(x, 2)); return [r]; }
table.push(["tArray_indexOf_round_loop", "Array", "indexOf", true, tArray_indexOf_round_loop]);
function tArray_indexOf_round_watched(x: number[], k: any): any { try { const r = x.indexOf(addAndDelete(x, 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_indexOf_round_watched", "Array", "indexOf", true, tArray_indexOf_round_watched]);
function tArray_indexOf_conditional_plain(x: number[], k: any): any { const r = x.indexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["tArray_indexOf_conditional_plain", "Array", "indexOf", true, tArray_indexOf_conditional_plain]);
function tArray_indexOf_conditional_tail(x: number[], k: any): any { return x.indexOf((k ? note("yes", 2) : note("no", undefined))); }
table.push(["tArray_indexOf_conditional_tail", "Array", "indexOf", true, tArray_indexOf_conditional_tail]);
function tArray_indexOf_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["tArray_indexOf_conditional_loop", "Array", "indexOf", true, tArray_indexOf_conditional_loop]);
function tArray_indexOf_conditional_watched(x: number[], k: any): any { try { const r = x.indexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_indexOf_conditional_watched", "Array", "indexOf", true, tArray_indexOf_conditional_watched]);
function tArray_indexOf_throws_plain(x: number[], k: any): any { const r = x.indexOf(fail(2)); return [r]; }
table.push(["tArray_indexOf_throws_plain", "Array", "indexOf", true, tArray_indexOf_throws_plain]);
function tArray_indexOf_throws_tail(x: number[], k: any): any { return x.indexOf(fail(2)); }
table.push(["tArray_indexOf_throws_tail", "Array", "indexOf", true, tArray_indexOf_throws_tail]);
function tArray_indexOf_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.indexOf(fail(2)); return [r]; }
table.push(["tArray_indexOf_throws_loop", "Array", "indexOf", true, tArray_indexOf_throws_loop]);
function tArray_indexOf_throws_watched(x: number[], k: any): any { try { const r = x.indexOf(fail(2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_indexOf_throws_watched", "Array", "indexOf", true, tArray_indexOf_throws_watched]);
function tArray_includes_call_plain(x: number[], k: any): any { const r = x.includes(note("argument", 2)); return [r]; }
table.push(["tArray_includes_call_plain", "Array", "includes", true, tArray_includes_call_plain]);
function tArray_includes_call_tail(x: number[], k: any): any { return x.includes(note("argument", 2)); }
table.push(["tArray_includes_call_tail", "Array", "includes", true, tArray_includes_call_tail]);
function tArray_includes_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(note("argument", 2)); return [r]; }
table.push(["tArray_includes_call_loop", "Array", "includes", true, tArray_includes_call_loop]);
function tArray_includes_call_watched(x: number[], k: any): any { try { const r = x.includes(note("argument", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_includes_call_watched", "Array", "includes", true, tArray_includes_call_watched]);
function tArray_includes_getter_plain(x: number[], k: any): any { const r = x.includes(holder(2).value); return [r]; }
table.push(["tArray_includes_getter_plain", "Array", "includes", true, tArray_includes_getter_plain]);
function tArray_includes_getter_tail(x: number[], k: any): any { return x.includes(holder(2).value); }
table.push(["tArray_includes_getter_tail", "Array", "includes", true, tArray_includes_getter_tail]);
function tArray_includes_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(holder(2).value); return [r]; }
table.push(["tArray_includes_getter_loop", "Array", "includes", true, tArray_includes_getter_loop]);
function tArray_includes_getter_watched(x: number[], k: any): any { try { const r = x.includes(holder(2).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_includes_getter_watched", "Array", "includes", true, tArray_includes_getter_watched]);
function tArray_includes_own_plain(x: number[], k: any): any { const r = x.includes(alterOwn(x, "includes", 2)); return [r]; }
table.push(["tArray_includes_own_plain", "Array", "includes", true, tArray_includes_own_plain]);
function tArray_includes_own_tail(x: number[], k: any): any { return x.includes(alterOwn(x, "includes", 2)); }
table.push(["tArray_includes_own_tail", "Array", "includes", true, tArray_includes_own_tail]);
function tArray_includes_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(alterOwn(x, "includes", 2)); return [r]; }
table.push(["tArray_includes_own_loop", "Array", "includes", true, tArray_includes_own_loop]);
function tArray_includes_own_watched(x: number[], k: any): any { try { const r = x.includes(alterOwn(x, "includes", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_includes_own_watched", "Array", "includes", true, tArray_includes_own_watched]);
function tArray_includes_prototype_plain(x: number[], k: any): any { const r = x.includes(alterPrototype(x, "includes", 2)); return [r]; }
table.push(["tArray_includes_prototype_plain", "Array", "includes", true, tArray_includes_prototype_plain]);
function tArray_includes_prototype_tail(x: number[], k: any): any { return x.includes(alterPrototype(x, "includes", 2)); }
table.push(["tArray_includes_prototype_tail", "Array", "includes", true, tArray_includes_prototype_tail]);
function tArray_includes_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(alterPrototype(x, "includes", 2)); return [r]; }
table.push(["tArray_includes_prototype_loop", "Array", "includes", true, tArray_includes_prototype_loop]);
function tArray_includes_prototype_watched(x: number[], k: any): any { try { const r = x.includes(alterPrototype(x, "includes", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_includes_prototype_watched", "Array", "includes", true, tArray_includes_prototype_watched]);
function tArray_includes_round_plain(x: number[], k: any): any { const r = x.includes(addAndDelete(x, 2)); return [r]; }
table.push(["tArray_includes_round_plain", "Array", "includes", true, tArray_includes_round_plain]);
function tArray_includes_round_tail(x: number[], k: any): any { return x.includes(addAndDelete(x, 2)); }
table.push(["tArray_includes_round_tail", "Array", "includes", true, tArray_includes_round_tail]);
function tArray_includes_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(addAndDelete(x, 2)); return [r]; }
table.push(["tArray_includes_round_loop", "Array", "includes", true, tArray_includes_round_loop]);
function tArray_includes_round_watched(x: number[], k: any): any { try { const r = x.includes(addAndDelete(x, 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_includes_round_watched", "Array", "includes", true, tArray_includes_round_watched]);
function tArray_includes_conditional_plain(x: number[], k: any): any { const r = x.includes((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["tArray_includes_conditional_plain", "Array", "includes", true, tArray_includes_conditional_plain]);
function tArray_includes_conditional_tail(x: number[], k: any): any { return x.includes((k ? note("yes", 2) : note("no", undefined))); }
table.push(["tArray_includes_conditional_tail", "Array", "includes", true, tArray_includes_conditional_tail]);
function tArray_includes_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["tArray_includes_conditional_loop", "Array", "includes", true, tArray_includes_conditional_loop]);
function tArray_includes_conditional_watched(x: number[], k: any): any { try { const r = x.includes((k ? note("yes", 2) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_includes_conditional_watched", "Array", "includes", true, tArray_includes_conditional_watched]);
function tArray_includes_throws_plain(x: number[], k: any): any { const r = x.includes(fail(2)); return [r]; }
table.push(["tArray_includes_throws_plain", "Array", "includes", true, tArray_includes_throws_plain]);
function tArray_includes_throws_tail(x: number[], k: any): any { return x.includes(fail(2)); }
table.push(["tArray_includes_throws_tail", "Array", "includes", true, tArray_includes_throws_tail]);
function tArray_includes_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.includes(fail(2)); return [r]; }
table.push(["tArray_includes_throws_loop", "Array", "includes", true, tArray_includes_throws_loop]);
function tArray_includes_throws_watched(x: number[], k: any): any { try { const r = x.includes(fail(2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_includes_throws_watched", "Array", "includes", true, tArray_includes_throws_watched]);
function tArray_join_call_plain(x: number[], k: any): any { const r = x.join(note("argument", "-")); return [r]; }
table.push(["tArray_join_call_plain", "Array", "join", true, tArray_join_call_plain]);
function tArray_join_call_tail(x: number[], k: any): any { return x.join(note("argument", "-")); }
table.push(["tArray_join_call_tail", "Array", "join", true, tArray_join_call_tail]);
function tArray_join_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(note("argument", "-")); return [r]; }
table.push(["tArray_join_call_loop", "Array", "join", true, tArray_join_call_loop]);
function tArray_join_call_watched(x: number[], k: any): any { try { const r = x.join(note("argument", "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_join_call_watched", "Array", "join", true, tArray_join_call_watched]);
function tArray_join_getter_plain(x: number[], k: any): any { const r = x.join(holder("-").value); return [r]; }
table.push(["tArray_join_getter_plain", "Array", "join", true, tArray_join_getter_plain]);
function tArray_join_getter_tail(x: number[], k: any): any { return x.join(holder("-").value); }
table.push(["tArray_join_getter_tail", "Array", "join", true, tArray_join_getter_tail]);
function tArray_join_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(holder("-").value); return [r]; }
table.push(["tArray_join_getter_loop", "Array", "join", true, tArray_join_getter_loop]);
function tArray_join_getter_watched(x: number[], k: any): any { try { const r = x.join(holder("-").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_join_getter_watched", "Array", "join", true, tArray_join_getter_watched]);
function tArray_join_own_plain(x: number[], k: any): any { const r = x.join(alterOwn(x, "join", "-")); return [r]; }
table.push(["tArray_join_own_plain", "Array", "join", true, tArray_join_own_plain]);
function tArray_join_own_tail(x: number[], k: any): any { return x.join(alterOwn(x, "join", "-")); }
table.push(["tArray_join_own_tail", "Array", "join", true, tArray_join_own_tail]);
function tArray_join_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(alterOwn(x, "join", "-")); return [r]; }
table.push(["tArray_join_own_loop", "Array", "join", true, tArray_join_own_loop]);
function tArray_join_own_watched(x: number[], k: any): any { try { const r = x.join(alterOwn(x, "join", "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_join_own_watched", "Array", "join", true, tArray_join_own_watched]);
function tArray_join_prototype_plain(x: number[], k: any): any { const r = x.join(alterPrototype(x, "join", "-")); return [r]; }
table.push(["tArray_join_prototype_plain", "Array", "join", true, tArray_join_prototype_plain]);
function tArray_join_prototype_tail(x: number[], k: any): any { return x.join(alterPrototype(x, "join", "-")); }
table.push(["tArray_join_prototype_tail", "Array", "join", true, tArray_join_prototype_tail]);
function tArray_join_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(alterPrototype(x, "join", "-")); return [r]; }
table.push(["tArray_join_prototype_loop", "Array", "join", true, tArray_join_prototype_loop]);
function tArray_join_prototype_watched(x: number[], k: any): any { try { const r = x.join(alterPrototype(x, "join", "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_join_prototype_watched", "Array", "join", true, tArray_join_prototype_watched]);
function tArray_join_round_plain(x: number[], k: any): any { const r = x.join(addAndDelete(x, "-")); return [r]; }
table.push(["tArray_join_round_plain", "Array", "join", true, tArray_join_round_plain]);
function tArray_join_round_tail(x: number[], k: any): any { return x.join(addAndDelete(x, "-")); }
table.push(["tArray_join_round_tail", "Array", "join", true, tArray_join_round_tail]);
function tArray_join_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(addAndDelete(x, "-")); return [r]; }
table.push(["tArray_join_round_loop", "Array", "join", true, tArray_join_round_loop]);
function tArray_join_round_watched(x: number[], k: any): any { try { const r = x.join(addAndDelete(x, "-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_join_round_watched", "Array", "join", true, tArray_join_round_watched]);
function tArray_join_conditional_plain(x: number[], k: any): any { const r = x.join((k ? note("yes", "-") : note("no", undefined))); return [r]; }
table.push(["tArray_join_conditional_plain", "Array", "join", true, tArray_join_conditional_plain]);
function tArray_join_conditional_tail(x: number[], k: any): any { return x.join((k ? note("yes", "-") : note("no", undefined))); }
table.push(["tArray_join_conditional_tail", "Array", "join", true, tArray_join_conditional_tail]);
function tArray_join_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join((k ? note("yes", "-") : note("no", undefined))); return [r]; }
table.push(["tArray_join_conditional_loop", "Array", "join", true, tArray_join_conditional_loop]);
function tArray_join_conditional_watched(x: number[], k: any): any { try { const r = x.join((k ? note("yes", "-") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_join_conditional_watched", "Array", "join", true, tArray_join_conditional_watched]);
function tArray_join_throws_plain(x: number[], k: any): any { const r = x.join(fail("-")); return [r]; }
table.push(["tArray_join_throws_plain", "Array", "join", true, tArray_join_throws_plain]);
function tArray_join_throws_tail(x: number[], k: any): any { return x.join(fail("-")); }
table.push(["tArray_join_throws_tail", "Array", "join", true, tArray_join_throws_tail]);
function tArray_join_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.join(fail("-")); return [r]; }
table.push(["tArray_join_throws_loop", "Array", "join", true, tArray_join_throws_loop]);
function tArray_join_throws_watched(x: number[], k: any): any { try { const r = x.join(fail("-")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_join_throws_watched", "Array", "join", true, tArray_join_throws_watched]);
function tArray_concat_call_plain(x: number[], k: any): any { const r = x.concat(note("argument", 9)); return [r]; }
table.push(["tArray_concat_call_plain", "Array", "concat", true, tArray_concat_call_plain]);
function tArray_concat_call_tail(x: number[], k: any): any { return x.concat(note("argument", 9)); }
table.push(["tArray_concat_call_tail", "Array", "concat", true, tArray_concat_call_tail]);
function tArray_concat_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(note("argument", 9)); return [r]; }
table.push(["tArray_concat_call_loop", "Array", "concat", true, tArray_concat_call_loop]);
function tArray_concat_call_watched(x: number[], k: any): any { try { const r = x.concat(note("argument", 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_concat_call_watched", "Array", "concat", true, tArray_concat_call_watched]);
function tArray_concat_getter_plain(x: number[], k: any): any { const r = x.concat(holder(9).value); return [r]; }
table.push(["tArray_concat_getter_plain", "Array", "concat", true, tArray_concat_getter_plain]);
function tArray_concat_getter_tail(x: number[], k: any): any { return x.concat(holder(9).value); }
table.push(["tArray_concat_getter_tail", "Array", "concat", true, tArray_concat_getter_tail]);
function tArray_concat_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(holder(9).value); return [r]; }
table.push(["tArray_concat_getter_loop", "Array", "concat", true, tArray_concat_getter_loop]);
function tArray_concat_getter_watched(x: number[], k: any): any { try { const r = x.concat(holder(9).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_concat_getter_watched", "Array", "concat", true, tArray_concat_getter_watched]);
function tArray_concat_own_plain(x: number[], k: any): any { const r = x.concat(alterOwn(x, "concat", 9)); return [r]; }
table.push(["tArray_concat_own_plain", "Array", "concat", true, tArray_concat_own_plain]);
function tArray_concat_own_tail(x: number[], k: any): any { return x.concat(alterOwn(x, "concat", 9)); }
table.push(["tArray_concat_own_tail", "Array", "concat", true, tArray_concat_own_tail]);
function tArray_concat_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(alterOwn(x, "concat", 9)); return [r]; }
table.push(["tArray_concat_own_loop", "Array", "concat", true, tArray_concat_own_loop]);
function tArray_concat_own_watched(x: number[], k: any): any { try { const r = x.concat(alterOwn(x, "concat", 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_concat_own_watched", "Array", "concat", true, tArray_concat_own_watched]);
function tArray_concat_prototype_plain(x: number[], k: any): any { const r = x.concat(alterPrototype(x, "concat", 9)); return [r]; }
table.push(["tArray_concat_prototype_plain", "Array", "concat", true, tArray_concat_prototype_plain]);
function tArray_concat_prototype_tail(x: number[], k: any): any { return x.concat(alterPrototype(x, "concat", 9)); }
table.push(["tArray_concat_prototype_tail", "Array", "concat", true, tArray_concat_prototype_tail]);
function tArray_concat_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(alterPrototype(x, "concat", 9)); return [r]; }
table.push(["tArray_concat_prototype_loop", "Array", "concat", true, tArray_concat_prototype_loop]);
function tArray_concat_prototype_watched(x: number[], k: any): any { try { const r = x.concat(alterPrototype(x, "concat", 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_concat_prototype_watched", "Array", "concat", true, tArray_concat_prototype_watched]);
function tArray_concat_round_plain(x: number[], k: any): any { const r = x.concat(addAndDelete(x, 9)); return [r]; }
table.push(["tArray_concat_round_plain", "Array", "concat", true, tArray_concat_round_plain]);
function tArray_concat_round_tail(x: number[], k: any): any { return x.concat(addAndDelete(x, 9)); }
table.push(["tArray_concat_round_tail", "Array", "concat", true, tArray_concat_round_tail]);
function tArray_concat_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(addAndDelete(x, 9)); return [r]; }
table.push(["tArray_concat_round_loop", "Array", "concat", true, tArray_concat_round_loop]);
function tArray_concat_round_watched(x: number[], k: any): any { try { const r = x.concat(addAndDelete(x, 9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_concat_round_watched", "Array", "concat", true, tArray_concat_round_watched]);
function tArray_concat_conditional_plain(x: number[], k: any): any { const r = x.concat((k ? note("yes", 9) : note("no", undefined))); return [r]; }
table.push(["tArray_concat_conditional_plain", "Array", "concat", true, tArray_concat_conditional_plain]);
function tArray_concat_conditional_tail(x: number[], k: any): any { return x.concat((k ? note("yes", 9) : note("no", undefined))); }
table.push(["tArray_concat_conditional_tail", "Array", "concat", true, tArray_concat_conditional_tail]);
function tArray_concat_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat((k ? note("yes", 9) : note("no", undefined))); return [r]; }
table.push(["tArray_concat_conditional_loop", "Array", "concat", true, tArray_concat_conditional_loop]);
function tArray_concat_conditional_watched(x: number[], k: any): any { try { const r = x.concat((k ? note("yes", 9) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_concat_conditional_watched", "Array", "concat", true, tArray_concat_conditional_watched]);
function tArray_concat_throws_plain(x: number[], k: any): any { const r = x.concat(fail(9)); return [r]; }
table.push(["tArray_concat_throws_plain", "Array", "concat", true, tArray_concat_throws_plain]);
function tArray_concat_throws_tail(x: number[], k: any): any { return x.concat(fail(9)); }
table.push(["tArray_concat_throws_tail", "Array", "concat", true, tArray_concat_throws_tail]);
function tArray_concat_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.concat(fail(9)); return [r]; }
table.push(["tArray_concat_throws_loop", "Array", "concat", true, tArray_concat_throws_loop]);
function tArray_concat_throws_watched(x: number[], k: any): any { try { const r = x.concat(fail(9)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_concat_throws_watched", "Array", "concat", true, tArray_concat_throws_watched]);
function tArray_at_call_plain(x: number[], k: any): any { const r = x.at(note("argument", 1)); return [r]; }
table.push(["tArray_at_call_plain", "Array", "at", true, tArray_at_call_plain]);
function tArray_at_call_tail(x: number[], k: any): any { return x.at(note("argument", 1)); }
table.push(["tArray_at_call_tail", "Array", "at", true, tArray_at_call_tail]);
function tArray_at_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(note("argument", 1)); return [r]; }
table.push(["tArray_at_call_loop", "Array", "at", true, tArray_at_call_loop]);
function tArray_at_call_watched(x: number[], k: any): any { try { const r = x.at(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_at_call_watched", "Array", "at", true, tArray_at_call_watched]);
function tArray_at_getter_plain(x: number[], k: any): any { const r = x.at(holder(1).value); return [r]; }
table.push(["tArray_at_getter_plain", "Array", "at", true, tArray_at_getter_plain]);
function tArray_at_getter_tail(x: number[], k: any): any { return x.at(holder(1).value); }
table.push(["tArray_at_getter_tail", "Array", "at", true, tArray_at_getter_tail]);
function tArray_at_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(holder(1).value); return [r]; }
table.push(["tArray_at_getter_loop", "Array", "at", true, tArray_at_getter_loop]);
function tArray_at_getter_watched(x: number[], k: any): any { try { const r = x.at(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_at_getter_watched", "Array", "at", true, tArray_at_getter_watched]);
function tArray_at_own_plain(x: number[], k: any): any { const r = x.at(alterOwn(x, "at", 1)); return [r]; }
table.push(["tArray_at_own_plain", "Array", "at", true, tArray_at_own_plain]);
function tArray_at_own_tail(x: number[], k: any): any { return x.at(alterOwn(x, "at", 1)); }
table.push(["tArray_at_own_tail", "Array", "at", true, tArray_at_own_tail]);
function tArray_at_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(alterOwn(x, "at", 1)); return [r]; }
table.push(["tArray_at_own_loop", "Array", "at", true, tArray_at_own_loop]);
function tArray_at_own_watched(x: number[], k: any): any { try { const r = x.at(alterOwn(x, "at", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_at_own_watched", "Array", "at", true, tArray_at_own_watched]);
function tArray_at_prototype_plain(x: number[], k: any): any { const r = x.at(alterPrototype(x, "at", 1)); return [r]; }
table.push(["tArray_at_prototype_plain", "Array", "at", true, tArray_at_prototype_plain]);
function tArray_at_prototype_tail(x: number[], k: any): any { return x.at(alterPrototype(x, "at", 1)); }
table.push(["tArray_at_prototype_tail", "Array", "at", true, tArray_at_prototype_tail]);
function tArray_at_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(alterPrototype(x, "at", 1)); return [r]; }
table.push(["tArray_at_prototype_loop", "Array", "at", true, tArray_at_prototype_loop]);
function tArray_at_prototype_watched(x: number[], k: any): any { try { const r = x.at(alterPrototype(x, "at", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_at_prototype_watched", "Array", "at", true, tArray_at_prototype_watched]);
function tArray_at_round_plain(x: number[], k: any): any { const r = x.at(addAndDelete(x, 1)); return [r]; }
table.push(["tArray_at_round_plain", "Array", "at", true, tArray_at_round_plain]);
function tArray_at_round_tail(x: number[], k: any): any { return x.at(addAndDelete(x, 1)); }
table.push(["tArray_at_round_tail", "Array", "at", true, tArray_at_round_tail]);
function tArray_at_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(addAndDelete(x, 1)); return [r]; }
table.push(["tArray_at_round_loop", "Array", "at", true, tArray_at_round_loop]);
function tArray_at_round_watched(x: number[], k: any): any { try { const r = x.at(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_at_round_watched", "Array", "at", true, tArray_at_round_watched]);
function tArray_at_conditional_plain(x: number[], k: any): any { const r = x.at((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["tArray_at_conditional_plain", "Array", "at", true, tArray_at_conditional_plain]);
function tArray_at_conditional_tail(x: number[], k: any): any { return x.at((k ? note("yes", 1) : note("no", undefined))); }
table.push(["tArray_at_conditional_tail", "Array", "at", true, tArray_at_conditional_tail]);
function tArray_at_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["tArray_at_conditional_loop", "Array", "at", true, tArray_at_conditional_loop]);
function tArray_at_conditional_watched(x: number[], k: any): any { try { const r = x.at((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_at_conditional_watched", "Array", "at", true, tArray_at_conditional_watched]);
function tArray_at_throws_plain(x: number[], k: any): any { const r = x.at(fail(1)); return [r]; }
table.push(["tArray_at_throws_plain", "Array", "at", true, tArray_at_throws_plain]);
function tArray_at_throws_tail(x: number[], k: any): any { return x.at(fail(1)); }
table.push(["tArray_at_throws_tail", "Array", "at", true, tArray_at_throws_tail]);
function tArray_at_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.at(fail(1)); return [r]; }
table.push(["tArray_at_throws_loop", "Array", "at", true, tArray_at_throws_loop]);
function tArray_at_throws_watched(x: number[], k: any): any { try { const r = x.at(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_at_throws_watched", "Array", "at", true, tArray_at_throws_watched]);
function tArray_lastIndexOf_call_plain(x: number[], k: any): any { const r = x.lastIndexOf(note("argument", 2)); return [r]; }
table.push(["tArray_lastIndexOf_call_plain", "Array", "lastIndexOf", true, tArray_lastIndexOf_call_plain]);
function tArray_lastIndexOf_call_tail(x: number[], k: any): any { return x.lastIndexOf(note("argument", 2)); }
table.push(["tArray_lastIndexOf_call_tail", "Array", "lastIndexOf", true, tArray_lastIndexOf_call_tail]);
function tArray_lastIndexOf_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(note("argument", 2)); return [r]; }
table.push(["tArray_lastIndexOf_call_loop", "Array", "lastIndexOf", true, tArray_lastIndexOf_call_loop]);
function tArray_lastIndexOf_call_watched(x: number[], k: any): any { try { const r = x.lastIndexOf(note("argument", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_lastIndexOf_call_watched", "Array", "lastIndexOf", true, tArray_lastIndexOf_call_watched]);
function tArray_lastIndexOf_getter_plain(x: number[], k: any): any { const r = x.lastIndexOf(holder(2).value); return [r]; }
table.push(["tArray_lastIndexOf_getter_plain", "Array", "lastIndexOf", true, tArray_lastIndexOf_getter_plain]);
function tArray_lastIndexOf_getter_tail(x: number[], k: any): any { return x.lastIndexOf(holder(2).value); }
table.push(["tArray_lastIndexOf_getter_tail", "Array", "lastIndexOf", true, tArray_lastIndexOf_getter_tail]);
function tArray_lastIndexOf_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(holder(2).value); return [r]; }
table.push(["tArray_lastIndexOf_getter_loop", "Array", "lastIndexOf", true, tArray_lastIndexOf_getter_loop]);
function tArray_lastIndexOf_getter_watched(x: number[], k: any): any { try { const r = x.lastIndexOf(holder(2).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_lastIndexOf_getter_watched", "Array", "lastIndexOf", true, tArray_lastIndexOf_getter_watched]);
function tArray_lastIndexOf_own_plain(x: number[], k: any): any { const r = x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); return [r]; }
table.push(["tArray_lastIndexOf_own_plain", "Array", "lastIndexOf", true, tArray_lastIndexOf_own_plain]);
function tArray_lastIndexOf_own_tail(x: number[], k: any): any { return x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); }
table.push(["tArray_lastIndexOf_own_tail", "Array", "lastIndexOf", true, tArray_lastIndexOf_own_tail]);
function tArray_lastIndexOf_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); return [r]; }
table.push(["tArray_lastIndexOf_own_loop", "Array", "lastIndexOf", true, tArray_lastIndexOf_own_loop]);
function tArray_lastIndexOf_own_watched(x: number[], k: any): any { try { const r = x.lastIndexOf(alterOwn(x, "lastIndexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_lastIndexOf_own_watched", "Array", "lastIndexOf", true, tArray_lastIndexOf_own_watched]);
function tArray_lastIndexOf_prototype_plain(x: number[], k: any): any { const r = x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); return [r]; }
table.push(["tArray_lastIndexOf_prototype_plain", "Array", "lastIndexOf", true, tArray_lastIndexOf_prototype_plain]);
function tArray_lastIndexOf_prototype_tail(x: number[], k: any): any { return x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); }
table.push(["tArray_lastIndexOf_prototype_tail", "Array", "lastIndexOf", true, tArray_lastIndexOf_prototype_tail]);
function tArray_lastIndexOf_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); return [r]; }
table.push(["tArray_lastIndexOf_prototype_loop", "Array", "lastIndexOf", true, tArray_lastIndexOf_prototype_loop]);
function tArray_lastIndexOf_prototype_watched(x: number[], k: any): any { try { const r = x.lastIndexOf(alterPrototype(x, "lastIndexOf", 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_lastIndexOf_prototype_watched", "Array", "lastIndexOf", true, tArray_lastIndexOf_prototype_watched]);
function tArray_lastIndexOf_round_plain(x: number[], k: any): any { const r = x.lastIndexOf(addAndDelete(x, 2)); return [r]; }
table.push(["tArray_lastIndexOf_round_plain", "Array", "lastIndexOf", true, tArray_lastIndexOf_round_plain]);
function tArray_lastIndexOf_round_tail(x: number[], k: any): any { return x.lastIndexOf(addAndDelete(x, 2)); }
table.push(["tArray_lastIndexOf_round_tail", "Array", "lastIndexOf", true, tArray_lastIndexOf_round_tail]);
function tArray_lastIndexOf_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(addAndDelete(x, 2)); return [r]; }
table.push(["tArray_lastIndexOf_round_loop", "Array", "lastIndexOf", true, tArray_lastIndexOf_round_loop]);
function tArray_lastIndexOf_round_watched(x: number[], k: any): any { try { const r = x.lastIndexOf(addAndDelete(x, 2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_lastIndexOf_round_watched", "Array", "lastIndexOf", true, tArray_lastIndexOf_round_watched]);
function tArray_lastIndexOf_conditional_plain(x: number[], k: any): any { const r = x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["tArray_lastIndexOf_conditional_plain", "Array", "lastIndexOf", true, tArray_lastIndexOf_conditional_plain]);
function tArray_lastIndexOf_conditional_tail(x: number[], k: any): any { return x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); }
table.push(["tArray_lastIndexOf_conditional_tail", "Array", "lastIndexOf", true, tArray_lastIndexOf_conditional_tail]);
function tArray_lastIndexOf_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; }
table.push(["tArray_lastIndexOf_conditional_loop", "Array", "lastIndexOf", true, tArray_lastIndexOf_conditional_loop]);
function tArray_lastIndexOf_conditional_watched(x: number[], k: any): any { try { const r = x.lastIndexOf((k ? note("yes", 2) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_lastIndexOf_conditional_watched", "Array", "lastIndexOf", true, tArray_lastIndexOf_conditional_watched]);
function tArray_lastIndexOf_throws_plain(x: number[], k: any): any { const r = x.lastIndexOf(fail(2)); return [r]; }
table.push(["tArray_lastIndexOf_throws_plain", "Array", "lastIndexOf", true, tArray_lastIndexOf_throws_plain]);
function tArray_lastIndexOf_throws_tail(x: number[], k: any): any { return x.lastIndexOf(fail(2)); }
table.push(["tArray_lastIndexOf_throws_tail", "Array", "lastIndexOf", true, tArray_lastIndexOf_throws_tail]);
function tArray_lastIndexOf_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.lastIndexOf(fail(2)); return [r]; }
table.push(["tArray_lastIndexOf_throws_loop", "Array", "lastIndexOf", true, tArray_lastIndexOf_throws_loop]);
function tArray_lastIndexOf_throws_watched(x: number[], k: any): any { try { const r = x.lastIndexOf(fail(2)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_lastIndexOf_throws_watched", "Array", "lastIndexOf", true, tArray_lastIndexOf_throws_watched]);
function tArray_fill_call_plain(x: number[], k: any): any { const r = x.fill(note("argument", 7)); return [r]; }
table.push(["tArray_fill_call_plain", "Array", "fill", true, tArray_fill_call_plain]);
function tArray_fill_call_tail(x: number[], k: any): any { return x.fill(note("argument", 7)); }
table.push(["tArray_fill_call_tail", "Array", "fill", true, tArray_fill_call_tail]);
function tArray_fill_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(note("argument", 7)); return [r]; }
table.push(["tArray_fill_call_loop", "Array", "fill", true, tArray_fill_call_loop]);
function tArray_fill_call_watched(x: number[], k: any): any { try { const r = x.fill(note("argument", 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_fill_call_watched", "Array", "fill", true, tArray_fill_call_watched]);
function tArray_fill_getter_plain(x: number[], k: any): any { const r = x.fill(holder(7).value); return [r]; }
table.push(["tArray_fill_getter_plain", "Array", "fill", true, tArray_fill_getter_plain]);
function tArray_fill_getter_tail(x: number[], k: any): any { return x.fill(holder(7).value); }
table.push(["tArray_fill_getter_tail", "Array", "fill", true, tArray_fill_getter_tail]);
function tArray_fill_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(holder(7).value); return [r]; }
table.push(["tArray_fill_getter_loop", "Array", "fill", true, tArray_fill_getter_loop]);
function tArray_fill_getter_watched(x: number[], k: any): any { try { const r = x.fill(holder(7).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_fill_getter_watched", "Array", "fill", true, tArray_fill_getter_watched]);
function tArray_fill_own_plain(x: number[], k: any): any { const r = x.fill(alterOwn(x, "fill", 7)); return [r]; }
table.push(["tArray_fill_own_plain", "Array", "fill", true, tArray_fill_own_plain]);
function tArray_fill_own_tail(x: number[], k: any): any { return x.fill(alterOwn(x, "fill", 7)); }
table.push(["tArray_fill_own_tail", "Array", "fill", true, tArray_fill_own_tail]);
function tArray_fill_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(alterOwn(x, "fill", 7)); return [r]; }
table.push(["tArray_fill_own_loop", "Array", "fill", true, tArray_fill_own_loop]);
function tArray_fill_own_watched(x: number[], k: any): any { try { const r = x.fill(alterOwn(x, "fill", 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_fill_own_watched", "Array", "fill", true, tArray_fill_own_watched]);
function tArray_fill_prototype_plain(x: number[], k: any): any { const r = x.fill(alterPrototype(x, "fill", 7)); return [r]; }
table.push(["tArray_fill_prototype_plain", "Array", "fill", true, tArray_fill_prototype_plain]);
function tArray_fill_prototype_tail(x: number[], k: any): any { return x.fill(alterPrototype(x, "fill", 7)); }
table.push(["tArray_fill_prototype_tail", "Array", "fill", true, tArray_fill_prototype_tail]);
function tArray_fill_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(alterPrototype(x, "fill", 7)); return [r]; }
table.push(["tArray_fill_prototype_loop", "Array", "fill", true, tArray_fill_prototype_loop]);
function tArray_fill_prototype_watched(x: number[], k: any): any { try { const r = x.fill(alterPrototype(x, "fill", 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_fill_prototype_watched", "Array", "fill", true, tArray_fill_prototype_watched]);
function tArray_fill_round_plain(x: number[], k: any): any { const r = x.fill(addAndDelete(x, 7)); return [r]; }
table.push(["tArray_fill_round_plain", "Array", "fill", true, tArray_fill_round_plain]);
function tArray_fill_round_tail(x: number[], k: any): any { return x.fill(addAndDelete(x, 7)); }
table.push(["tArray_fill_round_tail", "Array", "fill", true, tArray_fill_round_tail]);
function tArray_fill_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(addAndDelete(x, 7)); return [r]; }
table.push(["tArray_fill_round_loop", "Array", "fill", true, tArray_fill_round_loop]);
function tArray_fill_round_watched(x: number[], k: any): any { try { const r = x.fill(addAndDelete(x, 7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_fill_round_watched", "Array", "fill", true, tArray_fill_round_watched]);
function tArray_fill_conditional_plain(x: number[], k: any): any { const r = x.fill((k ? note("yes", 7) : note("no", undefined))); return [r]; }
table.push(["tArray_fill_conditional_plain", "Array", "fill", true, tArray_fill_conditional_plain]);
function tArray_fill_conditional_tail(x: number[], k: any): any { return x.fill((k ? note("yes", 7) : note("no", undefined))); }
table.push(["tArray_fill_conditional_tail", "Array", "fill", true, tArray_fill_conditional_tail]);
function tArray_fill_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill((k ? note("yes", 7) : note("no", undefined))); return [r]; }
table.push(["tArray_fill_conditional_loop", "Array", "fill", true, tArray_fill_conditional_loop]);
function tArray_fill_conditional_watched(x: number[], k: any): any { try { const r = x.fill((k ? note("yes", 7) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_fill_conditional_watched", "Array", "fill", true, tArray_fill_conditional_watched]);
function tArray_fill_throws_plain(x: number[], k: any): any { const r = x.fill(fail(7)); return [r]; }
table.push(["tArray_fill_throws_plain", "Array", "fill", true, tArray_fill_throws_plain]);
function tArray_fill_throws_tail(x: number[], k: any): any { return x.fill(fail(7)); }
table.push(["tArray_fill_throws_tail", "Array", "fill", true, tArray_fill_throws_tail]);
function tArray_fill_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.fill(fail(7)); return [r]; }
table.push(["tArray_fill_throws_loop", "Array", "fill", true, tArray_fill_throws_loop]);
function tArray_fill_throws_watched(x: number[], k: any): any { try { const r = x.fill(fail(7)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_fill_throws_watched", "Array", "fill", true, tArray_fill_throws_watched]);
function tArray_push_call_plain(x: number[], k: any): any { const r = x.push(note("argument", 6), 8); return [r]; }
table.push(["tArray_push_call_plain", "Array", "push", true, tArray_push_call_plain]);
function tArray_push_call_tail(x: number[], k: any): any { return x.push(note("argument", 6), 8); }
table.push(["tArray_push_call_tail", "Array", "push", true, tArray_push_call_tail]);
function tArray_push_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(note("argument", 6), 8); return [r]; }
table.push(["tArray_push_call_loop", "Array", "push", true, tArray_push_call_loop]);
function tArray_push_call_watched(x: number[], k: any): any { try { const r = x.push(note("argument", 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_push_call_watched", "Array", "push", true, tArray_push_call_watched]);
function tArray_push_getter_plain(x: number[], k: any): any { const r = x.push(holder(6).value, 8); return [r]; }
table.push(["tArray_push_getter_plain", "Array", "push", true, tArray_push_getter_plain]);
function tArray_push_getter_tail(x: number[], k: any): any { return x.push(holder(6).value, 8); }
table.push(["tArray_push_getter_tail", "Array", "push", true, tArray_push_getter_tail]);
function tArray_push_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(holder(6).value, 8); return [r]; }
table.push(["tArray_push_getter_loop", "Array", "push", true, tArray_push_getter_loop]);
function tArray_push_getter_watched(x: number[], k: any): any { try { const r = x.push(holder(6).value, 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_push_getter_watched", "Array", "push", true, tArray_push_getter_watched]);
function tArray_push_own_plain(x: number[], k: any): any { const r = x.push(alterOwn(x, "push", 6), 8); return [r]; }
table.push(["tArray_push_own_plain", "Array", "push", true, tArray_push_own_plain]);
function tArray_push_own_tail(x: number[], k: any): any { return x.push(alterOwn(x, "push", 6), 8); }
table.push(["tArray_push_own_tail", "Array", "push", true, tArray_push_own_tail]);
function tArray_push_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(alterOwn(x, "push", 6), 8); return [r]; }
table.push(["tArray_push_own_loop", "Array", "push", true, tArray_push_own_loop]);
function tArray_push_own_watched(x: number[], k: any): any { try { const r = x.push(alterOwn(x, "push", 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_push_own_watched", "Array", "push", true, tArray_push_own_watched]);
function tArray_push_prototype_plain(x: number[], k: any): any { const r = x.push(alterPrototype(x, "push", 6), 8); return [r]; }
table.push(["tArray_push_prototype_plain", "Array", "push", true, tArray_push_prototype_plain]);
function tArray_push_prototype_tail(x: number[], k: any): any { return x.push(alterPrototype(x, "push", 6), 8); }
table.push(["tArray_push_prototype_tail", "Array", "push", true, tArray_push_prototype_tail]);
function tArray_push_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(alterPrototype(x, "push", 6), 8); return [r]; }
table.push(["tArray_push_prototype_loop", "Array", "push", true, tArray_push_prototype_loop]);
function tArray_push_prototype_watched(x: number[], k: any): any { try { const r = x.push(alterPrototype(x, "push", 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_push_prototype_watched", "Array", "push", true, tArray_push_prototype_watched]);
function tArray_push_round_plain(x: number[], k: any): any { const r = x.push(addAndDelete(x, 6), 8); return [r]; }
table.push(["tArray_push_round_plain", "Array", "push", true, tArray_push_round_plain]);
function tArray_push_round_tail(x: number[], k: any): any { return x.push(addAndDelete(x, 6), 8); }
table.push(["tArray_push_round_tail", "Array", "push", true, tArray_push_round_tail]);
function tArray_push_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(addAndDelete(x, 6), 8); return [r]; }
table.push(["tArray_push_round_loop", "Array", "push", true, tArray_push_round_loop]);
function tArray_push_round_watched(x: number[], k: any): any { try { const r = x.push(addAndDelete(x, 6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_push_round_watched", "Array", "push", true, tArray_push_round_watched]);
function tArray_push_conditional_plain(x: number[], k: any): any { const r = x.push((k ? note("yes", 6) : note("no", undefined)), 8); return [r]; }
table.push(["tArray_push_conditional_plain", "Array", "push", true, tArray_push_conditional_plain]);
function tArray_push_conditional_tail(x: number[], k: any): any { return x.push((k ? note("yes", 6) : note("no", undefined)), 8); }
table.push(["tArray_push_conditional_tail", "Array", "push", true, tArray_push_conditional_tail]);
function tArray_push_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push((k ? note("yes", 6) : note("no", undefined)), 8); return [r]; }
table.push(["tArray_push_conditional_loop", "Array", "push", true, tArray_push_conditional_loop]);
function tArray_push_conditional_watched(x: number[], k: any): any { try { const r = x.push((k ? note("yes", 6) : note("no", undefined)), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_push_conditional_watched", "Array", "push", true, tArray_push_conditional_watched]);
function tArray_push_throws_plain(x: number[], k: any): any { const r = x.push(fail(6), 8); return [r]; }
table.push(["tArray_push_throws_plain", "Array", "push", true, tArray_push_throws_plain]);
function tArray_push_throws_tail(x: number[], k: any): any { return x.push(fail(6), 8); }
table.push(["tArray_push_throws_tail", "Array", "push", true, tArray_push_throws_tail]);
function tArray_push_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.push(fail(6), 8); return [r]; }
table.push(["tArray_push_throws_loop", "Array", "push", true, tArray_push_throws_loop]);
function tArray_push_throws_watched(x: number[], k: any): any { try { const r = x.push(fail(6), 8); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_push_throws_watched", "Array", "push", true, tArray_push_throws_watched]);
function tArray_unshift_call_plain(x: number[], k: any): any { const r = x.unshift(note("argument", 5)); return [r]; }
table.push(["tArray_unshift_call_plain", "Array", "unshift", true, tArray_unshift_call_plain]);
function tArray_unshift_call_tail(x: number[], k: any): any { return x.unshift(note("argument", 5)); }
table.push(["tArray_unshift_call_tail", "Array", "unshift", true, tArray_unshift_call_tail]);
function tArray_unshift_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(note("argument", 5)); return [r]; }
table.push(["tArray_unshift_call_loop", "Array", "unshift", true, tArray_unshift_call_loop]);
function tArray_unshift_call_watched(x: number[], k: any): any { try { const r = x.unshift(note("argument", 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_unshift_call_watched", "Array", "unshift", true, tArray_unshift_call_watched]);
function tArray_unshift_getter_plain(x: number[], k: any): any { const r = x.unshift(holder(5).value); return [r]; }
table.push(["tArray_unshift_getter_plain", "Array", "unshift", true, tArray_unshift_getter_plain]);
function tArray_unshift_getter_tail(x: number[], k: any): any { return x.unshift(holder(5).value); }
table.push(["tArray_unshift_getter_tail", "Array", "unshift", true, tArray_unshift_getter_tail]);
function tArray_unshift_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(holder(5).value); return [r]; }
table.push(["tArray_unshift_getter_loop", "Array", "unshift", true, tArray_unshift_getter_loop]);
function tArray_unshift_getter_watched(x: number[], k: any): any { try { const r = x.unshift(holder(5).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_unshift_getter_watched", "Array", "unshift", true, tArray_unshift_getter_watched]);
function tArray_unshift_own_plain(x: number[], k: any): any { const r = x.unshift(alterOwn(x, "unshift", 5)); return [r]; }
table.push(["tArray_unshift_own_plain", "Array", "unshift", true, tArray_unshift_own_plain]);
function tArray_unshift_own_tail(x: number[], k: any): any { return x.unshift(alterOwn(x, "unshift", 5)); }
table.push(["tArray_unshift_own_tail", "Array", "unshift", true, tArray_unshift_own_tail]);
function tArray_unshift_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(alterOwn(x, "unshift", 5)); return [r]; }
table.push(["tArray_unshift_own_loop", "Array", "unshift", true, tArray_unshift_own_loop]);
function tArray_unshift_own_watched(x: number[], k: any): any { try { const r = x.unshift(alterOwn(x, "unshift", 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_unshift_own_watched", "Array", "unshift", true, tArray_unshift_own_watched]);
function tArray_unshift_prototype_plain(x: number[], k: any): any { const r = x.unshift(alterPrototype(x, "unshift", 5)); return [r]; }
table.push(["tArray_unshift_prototype_plain", "Array", "unshift", true, tArray_unshift_prototype_plain]);
function tArray_unshift_prototype_tail(x: number[], k: any): any { return x.unshift(alterPrototype(x, "unshift", 5)); }
table.push(["tArray_unshift_prototype_tail", "Array", "unshift", true, tArray_unshift_prototype_tail]);
function tArray_unshift_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(alterPrototype(x, "unshift", 5)); return [r]; }
table.push(["tArray_unshift_prototype_loop", "Array", "unshift", true, tArray_unshift_prototype_loop]);
function tArray_unshift_prototype_watched(x: number[], k: any): any { try { const r = x.unshift(alterPrototype(x, "unshift", 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_unshift_prototype_watched", "Array", "unshift", true, tArray_unshift_prototype_watched]);
function tArray_unshift_round_plain(x: number[], k: any): any { const r = x.unshift(addAndDelete(x, 5)); return [r]; }
table.push(["tArray_unshift_round_plain", "Array", "unshift", true, tArray_unshift_round_plain]);
function tArray_unshift_round_tail(x: number[], k: any): any { return x.unshift(addAndDelete(x, 5)); }
table.push(["tArray_unshift_round_tail", "Array", "unshift", true, tArray_unshift_round_tail]);
function tArray_unshift_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(addAndDelete(x, 5)); return [r]; }
table.push(["tArray_unshift_round_loop", "Array", "unshift", true, tArray_unshift_round_loop]);
function tArray_unshift_round_watched(x: number[], k: any): any { try { const r = x.unshift(addAndDelete(x, 5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_unshift_round_watched", "Array", "unshift", true, tArray_unshift_round_watched]);
function tArray_unshift_conditional_plain(x: number[], k: any): any { const r = x.unshift((k ? note("yes", 5) : note("no", undefined))); return [r]; }
table.push(["tArray_unshift_conditional_plain", "Array", "unshift", true, tArray_unshift_conditional_plain]);
function tArray_unshift_conditional_tail(x: number[], k: any): any { return x.unshift((k ? note("yes", 5) : note("no", undefined))); }
table.push(["tArray_unshift_conditional_tail", "Array", "unshift", true, tArray_unshift_conditional_tail]);
function tArray_unshift_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift((k ? note("yes", 5) : note("no", undefined))); return [r]; }
table.push(["tArray_unshift_conditional_loop", "Array", "unshift", true, tArray_unshift_conditional_loop]);
function tArray_unshift_conditional_watched(x: number[], k: any): any { try { const r = x.unshift((k ? note("yes", 5) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_unshift_conditional_watched", "Array", "unshift", true, tArray_unshift_conditional_watched]);
function tArray_unshift_throws_plain(x: number[], k: any): any { const r = x.unshift(fail(5)); return [r]; }
table.push(["tArray_unshift_throws_plain", "Array", "unshift", true, tArray_unshift_throws_plain]);
function tArray_unshift_throws_tail(x: number[], k: any): any { return x.unshift(fail(5)); }
table.push(["tArray_unshift_throws_tail", "Array", "unshift", true, tArray_unshift_throws_tail]);
function tArray_unshift_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.unshift(fail(5)); return [r]; }
table.push(["tArray_unshift_throws_loop", "Array", "unshift", true, tArray_unshift_throws_loop]);
function tArray_unshift_throws_watched(x: number[], k: any): any { try { const r = x.unshift(fail(5)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_unshift_throws_watched", "Array", "unshift", true, tArray_unshift_throws_watched]);
function tArray_splice_call_plain(x: number[], k: any): any { const r = x.splice(note("argument", 1), 1); return [r]; }
table.push(["tArray_splice_call_plain", "Array", "splice", true, tArray_splice_call_plain]);
function tArray_splice_call_tail(x: number[], k: any): any { return x.splice(note("argument", 1), 1); }
table.push(["tArray_splice_call_tail", "Array", "splice", true, tArray_splice_call_tail]);
function tArray_splice_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(note("argument", 1), 1); return [r]; }
table.push(["tArray_splice_call_loop", "Array", "splice", true, tArray_splice_call_loop]);
function tArray_splice_call_watched(x: number[], k: any): any { try { const r = x.splice(note("argument", 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_splice_call_watched", "Array", "splice", true, tArray_splice_call_watched]);
function tArray_splice_getter_plain(x: number[], k: any): any { const r = x.splice(holder(1).value, 1); return [r]; }
table.push(["tArray_splice_getter_plain", "Array", "splice", true, tArray_splice_getter_plain]);
function tArray_splice_getter_tail(x: number[], k: any): any { return x.splice(holder(1).value, 1); }
table.push(["tArray_splice_getter_tail", "Array", "splice", true, tArray_splice_getter_tail]);
function tArray_splice_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(holder(1).value, 1); return [r]; }
table.push(["tArray_splice_getter_loop", "Array", "splice", true, tArray_splice_getter_loop]);
function tArray_splice_getter_watched(x: number[], k: any): any { try { const r = x.splice(holder(1).value, 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_splice_getter_watched", "Array", "splice", true, tArray_splice_getter_watched]);
function tArray_splice_own_plain(x: number[], k: any): any { const r = x.splice(alterOwn(x, "splice", 1), 1); return [r]; }
table.push(["tArray_splice_own_plain", "Array", "splice", true, tArray_splice_own_plain]);
function tArray_splice_own_tail(x: number[], k: any): any { return x.splice(alterOwn(x, "splice", 1), 1); }
table.push(["tArray_splice_own_tail", "Array", "splice", true, tArray_splice_own_tail]);
function tArray_splice_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(alterOwn(x, "splice", 1), 1); return [r]; }
table.push(["tArray_splice_own_loop", "Array", "splice", true, tArray_splice_own_loop]);
function tArray_splice_own_watched(x: number[], k: any): any { try { const r = x.splice(alterOwn(x, "splice", 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_splice_own_watched", "Array", "splice", true, tArray_splice_own_watched]);
function tArray_splice_prototype_plain(x: number[], k: any): any { const r = x.splice(alterPrototype(x, "splice", 1), 1); return [r]; }
table.push(["tArray_splice_prototype_plain", "Array", "splice", true, tArray_splice_prototype_plain]);
function tArray_splice_prototype_tail(x: number[], k: any): any { return x.splice(alterPrototype(x, "splice", 1), 1); }
table.push(["tArray_splice_prototype_tail", "Array", "splice", true, tArray_splice_prototype_tail]);
function tArray_splice_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(alterPrototype(x, "splice", 1), 1); return [r]; }
table.push(["tArray_splice_prototype_loop", "Array", "splice", true, tArray_splice_prototype_loop]);
function tArray_splice_prototype_watched(x: number[], k: any): any { try { const r = x.splice(alterPrototype(x, "splice", 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_splice_prototype_watched", "Array", "splice", true, tArray_splice_prototype_watched]);
function tArray_splice_round_plain(x: number[], k: any): any { const r = x.splice(addAndDelete(x, 1), 1); return [r]; }
table.push(["tArray_splice_round_plain", "Array", "splice", true, tArray_splice_round_plain]);
function tArray_splice_round_tail(x: number[], k: any): any { return x.splice(addAndDelete(x, 1), 1); }
table.push(["tArray_splice_round_tail", "Array", "splice", true, tArray_splice_round_tail]);
function tArray_splice_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(addAndDelete(x, 1), 1); return [r]; }
table.push(["tArray_splice_round_loop", "Array", "splice", true, tArray_splice_round_loop]);
function tArray_splice_round_watched(x: number[], k: any): any { try { const r = x.splice(addAndDelete(x, 1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_splice_round_watched", "Array", "splice", true, tArray_splice_round_watched]);
function tArray_splice_conditional_plain(x: number[], k: any): any { const r = x.splice((k ? note("yes", 1) : note("no", undefined)), 1); return [r]; }
table.push(["tArray_splice_conditional_plain", "Array", "splice", true, tArray_splice_conditional_plain]);
function tArray_splice_conditional_tail(x: number[], k: any): any { return x.splice((k ? note("yes", 1) : note("no", undefined)), 1); }
table.push(["tArray_splice_conditional_tail", "Array", "splice", true, tArray_splice_conditional_tail]);
function tArray_splice_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice((k ? note("yes", 1) : note("no", undefined)), 1); return [r]; }
table.push(["tArray_splice_conditional_loop", "Array", "splice", true, tArray_splice_conditional_loop]);
function tArray_splice_conditional_watched(x: number[], k: any): any { try { const r = x.splice((k ? note("yes", 1) : note("no", undefined)), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_splice_conditional_watched", "Array", "splice", true, tArray_splice_conditional_watched]);
function tArray_splice_throws_plain(x: number[], k: any): any { const r = x.splice(fail(1), 1); return [r]; }
table.push(["tArray_splice_throws_plain", "Array", "splice", true, tArray_splice_throws_plain]);
function tArray_splice_throws_tail(x: number[], k: any): any { return x.splice(fail(1), 1); }
table.push(["tArray_splice_throws_tail", "Array", "splice", true, tArray_splice_throws_tail]);
function tArray_splice_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.splice(fail(1), 1); return [r]; }
table.push(["tArray_splice_throws_loop", "Array", "splice", true, tArray_splice_throws_loop]);
function tArray_splice_throws_watched(x: number[], k: any): any { try { const r = x.splice(fail(1), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_splice_throws_watched", "Array", "splice", true, tArray_splice_throws_watched]);
function tArray_with_call_plain(x: number[], k: any): any { const r = x.with(note("argument", 0), 9); return [r]; }
table.push(["tArray_with_call_plain", "Array", "with", true, tArray_with_call_plain]);
function tArray_with_call_tail(x: number[], k: any): any { return x.with(note("argument", 0), 9); }
table.push(["tArray_with_call_tail", "Array", "with", true, tArray_with_call_tail]);
function tArray_with_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(note("argument", 0), 9); return [r]; }
table.push(["tArray_with_call_loop", "Array", "with", true, tArray_with_call_loop]);
function tArray_with_call_watched(x: number[], k: any): any { try { const r = x.with(note("argument", 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_with_call_watched", "Array", "with", true, tArray_with_call_watched]);
function tArray_with_getter_plain(x: number[], k: any): any { const r = x.with(holder(0).value, 9); return [r]; }
table.push(["tArray_with_getter_plain", "Array", "with", true, tArray_with_getter_plain]);
function tArray_with_getter_tail(x: number[], k: any): any { return x.with(holder(0).value, 9); }
table.push(["tArray_with_getter_tail", "Array", "with", true, tArray_with_getter_tail]);
function tArray_with_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(holder(0).value, 9); return [r]; }
table.push(["tArray_with_getter_loop", "Array", "with", true, tArray_with_getter_loop]);
function tArray_with_getter_watched(x: number[], k: any): any { try { const r = x.with(holder(0).value, 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_with_getter_watched", "Array", "with", true, tArray_with_getter_watched]);
function tArray_with_own_plain(x: number[], k: any): any { const r = x.with(alterOwn(x, "with", 0), 9); return [r]; }
table.push(["tArray_with_own_plain", "Array", "with", true, tArray_with_own_plain]);
function tArray_with_own_tail(x: number[], k: any): any { return x.with(alterOwn(x, "with", 0), 9); }
table.push(["tArray_with_own_tail", "Array", "with", true, tArray_with_own_tail]);
function tArray_with_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(alterOwn(x, "with", 0), 9); return [r]; }
table.push(["tArray_with_own_loop", "Array", "with", true, tArray_with_own_loop]);
function tArray_with_own_watched(x: number[], k: any): any { try { const r = x.with(alterOwn(x, "with", 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_with_own_watched", "Array", "with", true, tArray_with_own_watched]);
function tArray_with_prototype_plain(x: number[], k: any): any { const r = x.with(alterPrototype(x, "with", 0), 9); return [r]; }
table.push(["tArray_with_prototype_plain", "Array", "with", true, tArray_with_prototype_plain]);
function tArray_with_prototype_tail(x: number[], k: any): any { return x.with(alterPrototype(x, "with", 0), 9); }
table.push(["tArray_with_prototype_tail", "Array", "with", true, tArray_with_prototype_tail]);
function tArray_with_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(alterPrototype(x, "with", 0), 9); return [r]; }
table.push(["tArray_with_prototype_loop", "Array", "with", true, tArray_with_prototype_loop]);
function tArray_with_prototype_watched(x: number[], k: any): any { try { const r = x.with(alterPrototype(x, "with", 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_with_prototype_watched", "Array", "with", true, tArray_with_prototype_watched]);
function tArray_with_round_plain(x: number[], k: any): any { const r = x.with(addAndDelete(x, 0), 9); return [r]; }
table.push(["tArray_with_round_plain", "Array", "with", true, tArray_with_round_plain]);
function tArray_with_round_tail(x: number[], k: any): any { return x.with(addAndDelete(x, 0), 9); }
table.push(["tArray_with_round_tail", "Array", "with", true, tArray_with_round_tail]);
function tArray_with_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(addAndDelete(x, 0), 9); return [r]; }
table.push(["tArray_with_round_loop", "Array", "with", true, tArray_with_round_loop]);
function tArray_with_round_watched(x: number[], k: any): any { try { const r = x.with(addAndDelete(x, 0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_with_round_watched", "Array", "with", true, tArray_with_round_watched]);
function tArray_with_conditional_plain(x: number[], k: any): any { const r = x.with((k ? note("yes", 0) : note("no", undefined)), 9); return [r]; }
table.push(["tArray_with_conditional_plain", "Array", "with", true, tArray_with_conditional_plain]);
function tArray_with_conditional_tail(x: number[], k: any): any { return x.with((k ? note("yes", 0) : note("no", undefined)), 9); }
table.push(["tArray_with_conditional_tail", "Array", "with", true, tArray_with_conditional_tail]);
function tArray_with_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with((k ? note("yes", 0) : note("no", undefined)), 9); return [r]; }
table.push(["tArray_with_conditional_loop", "Array", "with", true, tArray_with_conditional_loop]);
function tArray_with_conditional_watched(x: number[], k: any): any { try { const r = x.with((k ? note("yes", 0) : note("no", undefined)), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_with_conditional_watched", "Array", "with", true, tArray_with_conditional_watched]);
function tArray_with_throws_plain(x: number[], k: any): any { const r = x.with(fail(0), 9); return [r]; }
table.push(["tArray_with_throws_plain", "Array", "with", true, tArray_with_throws_plain]);
function tArray_with_throws_tail(x: number[], k: any): any { return x.with(fail(0), 9); }
table.push(["tArray_with_throws_tail", "Array", "with", true, tArray_with_throws_tail]);
function tArray_with_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.with(fail(0), 9); return [r]; }
table.push(["tArray_with_throws_loop", "Array", "with", true, tArray_with_throws_loop]);
function tArray_with_throws_watched(x: number[], k: any): any { try { const r = x.with(fail(0), 9); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_with_throws_watched", "Array", "with", true, tArray_with_throws_watched]);
function tArray_flat_call_plain(x: number[], k: any): any { const r = x.flat(note("argument", 1)); return [r]; }
table.push(["tArray_flat_call_plain", "Array", "flat", true, tArray_flat_call_plain]);
function tArray_flat_call_tail(x: number[], k: any): any { return x.flat(note("argument", 1)); }
table.push(["tArray_flat_call_tail", "Array", "flat", true, tArray_flat_call_tail]);
function tArray_flat_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(note("argument", 1)); return [r]; }
table.push(["tArray_flat_call_loop", "Array", "flat", true, tArray_flat_call_loop]);
function tArray_flat_call_watched(x: number[], k: any): any { try { const r = x.flat(note("argument", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_flat_call_watched", "Array", "flat", true, tArray_flat_call_watched]);
function tArray_flat_getter_plain(x: number[], k: any): any { const r = x.flat(holder(1).value); return [r]; }
table.push(["tArray_flat_getter_plain", "Array", "flat", true, tArray_flat_getter_plain]);
function tArray_flat_getter_tail(x: number[], k: any): any { return x.flat(holder(1).value); }
table.push(["tArray_flat_getter_tail", "Array", "flat", true, tArray_flat_getter_tail]);
function tArray_flat_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(holder(1).value); return [r]; }
table.push(["tArray_flat_getter_loop", "Array", "flat", true, tArray_flat_getter_loop]);
function tArray_flat_getter_watched(x: number[], k: any): any { try { const r = x.flat(holder(1).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_flat_getter_watched", "Array", "flat", true, tArray_flat_getter_watched]);
function tArray_flat_own_plain(x: number[], k: any): any { const r = x.flat(alterOwn(x, "flat", 1)); return [r]; }
table.push(["tArray_flat_own_plain", "Array", "flat", true, tArray_flat_own_plain]);
function tArray_flat_own_tail(x: number[], k: any): any { return x.flat(alterOwn(x, "flat", 1)); }
table.push(["tArray_flat_own_tail", "Array", "flat", true, tArray_flat_own_tail]);
function tArray_flat_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(alterOwn(x, "flat", 1)); return [r]; }
table.push(["tArray_flat_own_loop", "Array", "flat", true, tArray_flat_own_loop]);
function tArray_flat_own_watched(x: number[], k: any): any { try { const r = x.flat(alterOwn(x, "flat", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_flat_own_watched", "Array", "flat", true, tArray_flat_own_watched]);
function tArray_flat_prototype_plain(x: number[], k: any): any { const r = x.flat(alterPrototype(x, "flat", 1)); return [r]; }
table.push(["tArray_flat_prototype_plain", "Array", "flat", true, tArray_flat_prototype_plain]);
function tArray_flat_prototype_tail(x: number[], k: any): any { return x.flat(alterPrototype(x, "flat", 1)); }
table.push(["tArray_flat_prototype_tail", "Array", "flat", true, tArray_flat_prototype_tail]);
function tArray_flat_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(alterPrototype(x, "flat", 1)); return [r]; }
table.push(["tArray_flat_prototype_loop", "Array", "flat", true, tArray_flat_prototype_loop]);
function tArray_flat_prototype_watched(x: number[], k: any): any { try { const r = x.flat(alterPrototype(x, "flat", 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_flat_prototype_watched", "Array", "flat", true, tArray_flat_prototype_watched]);
function tArray_flat_round_plain(x: number[], k: any): any { const r = x.flat(addAndDelete(x, 1)); return [r]; }
table.push(["tArray_flat_round_plain", "Array", "flat", true, tArray_flat_round_plain]);
function tArray_flat_round_tail(x: number[], k: any): any { return x.flat(addAndDelete(x, 1)); }
table.push(["tArray_flat_round_tail", "Array", "flat", true, tArray_flat_round_tail]);
function tArray_flat_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(addAndDelete(x, 1)); return [r]; }
table.push(["tArray_flat_round_loop", "Array", "flat", true, tArray_flat_round_loop]);
function tArray_flat_round_watched(x: number[], k: any): any { try { const r = x.flat(addAndDelete(x, 1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_flat_round_watched", "Array", "flat", true, tArray_flat_round_watched]);
function tArray_flat_conditional_plain(x: number[], k: any): any { const r = x.flat((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["tArray_flat_conditional_plain", "Array", "flat", true, tArray_flat_conditional_plain]);
function tArray_flat_conditional_tail(x: number[], k: any): any { return x.flat((k ? note("yes", 1) : note("no", undefined))); }
table.push(["tArray_flat_conditional_tail", "Array", "flat", true, tArray_flat_conditional_tail]);
function tArray_flat_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat((k ? note("yes", 1) : note("no", undefined))); return [r]; }
table.push(["tArray_flat_conditional_loop", "Array", "flat", true, tArray_flat_conditional_loop]);
function tArray_flat_conditional_watched(x: number[], k: any): any { try { const r = x.flat((k ? note("yes", 1) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_flat_conditional_watched", "Array", "flat", true, tArray_flat_conditional_watched]);
function tArray_flat_throws_plain(x: number[], k: any): any { const r = x.flat(fail(1)); return [r]; }
table.push(["tArray_flat_throws_plain", "Array", "flat", true, tArray_flat_throws_plain]);
function tArray_flat_throws_tail(x: number[], k: any): any { return x.flat(fail(1)); }
table.push(["tArray_flat_throws_tail", "Array", "flat", true, tArray_flat_throws_tail]);
function tArray_flat_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.flat(fail(1)); return [r]; }
table.push(["tArray_flat_throws_loop", "Array", "flat", true, tArray_flat_throws_loop]);
function tArray_flat_throws_watched(x: number[], k: any): any { try { const r = x.flat(fail(1)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_flat_throws_watched", "Array", "flat", true, tArray_flat_throws_watched]);
function tArray_toSpliced_call_plain(x: number[], k: any): any { const r = x.toSpliced(note("argument", 0), 1); return [r]; }
table.push(["tArray_toSpliced_call_plain", "Array", "toSpliced", true, tArray_toSpliced_call_plain]);
function tArray_toSpliced_call_tail(x: number[], k: any): any { return x.toSpliced(note("argument", 0), 1); }
table.push(["tArray_toSpliced_call_tail", "Array", "toSpliced", true, tArray_toSpliced_call_tail]);
function tArray_toSpliced_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(note("argument", 0), 1); return [r]; }
table.push(["tArray_toSpliced_call_loop", "Array", "toSpliced", true, tArray_toSpliced_call_loop]);
function tArray_toSpliced_call_watched(x: number[], k: any): any { try { const r = x.toSpliced(note("argument", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_toSpliced_call_watched", "Array", "toSpliced", true, tArray_toSpliced_call_watched]);
function tArray_toSpliced_getter_plain(x: number[], k: any): any { const r = x.toSpliced(holder(0).value, 1); return [r]; }
table.push(["tArray_toSpliced_getter_plain", "Array", "toSpliced", true, tArray_toSpliced_getter_plain]);
function tArray_toSpliced_getter_tail(x: number[], k: any): any { return x.toSpliced(holder(0).value, 1); }
table.push(["tArray_toSpliced_getter_tail", "Array", "toSpliced", true, tArray_toSpliced_getter_tail]);
function tArray_toSpliced_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(holder(0).value, 1); return [r]; }
table.push(["tArray_toSpliced_getter_loop", "Array", "toSpliced", true, tArray_toSpliced_getter_loop]);
function tArray_toSpliced_getter_watched(x: number[], k: any): any { try { const r = x.toSpliced(holder(0).value, 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_toSpliced_getter_watched", "Array", "toSpliced", true, tArray_toSpliced_getter_watched]);
function tArray_toSpliced_own_plain(x: number[], k: any): any { const r = x.toSpliced(alterOwn(x, "toSpliced", 0), 1); return [r]; }
table.push(["tArray_toSpliced_own_plain", "Array", "toSpliced", true, tArray_toSpliced_own_plain]);
function tArray_toSpliced_own_tail(x: number[], k: any): any { return x.toSpliced(alterOwn(x, "toSpliced", 0), 1); }
table.push(["tArray_toSpliced_own_tail", "Array", "toSpliced", true, tArray_toSpliced_own_tail]);
function tArray_toSpliced_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(alterOwn(x, "toSpliced", 0), 1); return [r]; }
table.push(["tArray_toSpliced_own_loop", "Array", "toSpliced", true, tArray_toSpliced_own_loop]);
function tArray_toSpliced_own_watched(x: number[], k: any): any { try { const r = x.toSpliced(alterOwn(x, "toSpliced", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_toSpliced_own_watched", "Array", "toSpliced", true, tArray_toSpliced_own_watched]);
function tArray_toSpliced_prototype_plain(x: number[], k: any): any { const r = x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); return [r]; }
table.push(["tArray_toSpliced_prototype_plain", "Array", "toSpliced", true, tArray_toSpliced_prototype_plain]);
function tArray_toSpliced_prototype_tail(x: number[], k: any): any { return x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); }
table.push(["tArray_toSpliced_prototype_tail", "Array", "toSpliced", true, tArray_toSpliced_prototype_tail]);
function tArray_toSpliced_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); return [r]; }
table.push(["tArray_toSpliced_prototype_loop", "Array", "toSpliced", true, tArray_toSpliced_prototype_loop]);
function tArray_toSpliced_prototype_watched(x: number[], k: any): any { try { const r = x.toSpliced(alterPrototype(x, "toSpliced", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_toSpliced_prototype_watched", "Array", "toSpliced", true, tArray_toSpliced_prototype_watched]);
function tArray_toSpliced_round_plain(x: number[], k: any): any { const r = x.toSpliced(addAndDelete(x, 0), 1); return [r]; }
table.push(["tArray_toSpliced_round_plain", "Array", "toSpliced", true, tArray_toSpliced_round_plain]);
function tArray_toSpliced_round_tail(x: number[], k: any): any { return x.toSpliced(addAndDelete(x, 0), 1); }
table.push(["tArray_toSpliced_round_tail", "Array", "toSpliced", true, tArray_toSpliced_round_tail]);
function tArray_toSpliced_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(addAndDelete(x, 0), 1); return [r]; }
table.push(["tArray_toSpliced_round_loop", "Array", "toSpliced", true, tArray_toSpliced_round_loop]);
function tArray_toSpliced_round_watched(x: number[], k: any): any { try { const r = x.toSpliced(addAndDelete(x, 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_toSpliced_round_watched", "Array", "toSpliced", true, tArray_toSpliced_round_watched]);
function tArray_toSpliced_conditional_plain(x: number[], k: any): any { const r = x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["tArray_toSpliced_conditional_plain", "Array", "toSpliced", true, tArray_toSpliced_conditional_plain]);
function tArray_toSpliced_conditional_tail(x: number[], k: any): any { return x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); }
table.push(["tArray_toSpliced_conditional_tail", "Array", "toSpliced", true, tArray_toSpliced_conditional_tail]);
function tArray_toSpliced_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["tArray_toSpliced_conditional_loop", "Array", "toSpliced", true, tArray_toSpliced_conditional_loop]);
function tArray_toSpliced_conditional_watched(x: number[], k: any): any { try { const r = x.toSpliced((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_toSpliced_conditional_watched", "Array", "toSpliced", true, tArray_toSpliced_conditional_watched]);
function tArray_toSpliced_throws_plain(x: number[], k: any): any { const r = x.toSpliced(fail(0), 1); return [r]; }
table.push(["tArray_toSpliced_throws_plain", "Array", "toSpliced", true, tArray_toSpliced_throws_plain]);
function tArray_toSpliced_throws_tail(x: number[], k: any): any { return x.toSpliced(fail(0), 1); }
table.push(["tArray_toSpliced_throws_tail", "Array", "toSpliced", true, tArray_toSpliced_throws_tail]);
function tArray_toSpliced_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.toSpliced(fail(0), 1); return [r]; }
table.push(["tArray_toSpliced_throws_loop", "Array", "toSpliced", true, tArray_toSpliced_throws_loop]);
function tArray_toSpliced_throws_watched(x: number[], k: any): any { try { const r = x.toSpliced(fail(0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_toSpliced_throws_watched", "Array", "toSpliced", true, tArray_toSpliced_throws_watched]);
function tArray_copyWithin_call_plain(x: number[], k: any): any { const r = x.copyWithin(note("argument", 0), 1); return [r]; }
table.push(["tArray_copyWithin_call_plain", "Array", "copyWithin", true, tArray_copyWithin_call_plain]);
function tArray_copyWithin_call_tail(x: number[], k: any): any { return x.copyWithin(note("argument", 0), 1); }
table.push(["tArray_copyWithin_call_tail", "Array", "copyWithin", true, tArray_copyWithin_call_tail]);
function tArray_copyWithin_call_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(note("argument", 0), 1); return [r]; }
table.push(["tArray_copyWithin_call_loop", "Array", "copyWithin", true, tArray_copyWithin_call_loop]);
function tArray_copyWithin_call_watched(x: number[], k: any): any { try { const r = x.copyWithin(note("argument", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_copyWithin_call_watched", "Array", "copyWithin", true, tArray_copyWithin_call_watched]);
function tArray_copyWithin_getter_plain(x: number[], k: any): any { const r = x.copyWithin(holder(0).value, 1); return [r]; }
table.push(["tArray_copyWithin_getter_plain", "Array", "copyWithin", true, tArray_copyWithin_getter_plain]);
function tArray_copyWithin_getter_tail(x: number[], k: any): any { return x.copyWithin(holder(0).value, 1); }
table.push(["tArray_copyWithin_getter_tail", "Array", "copyWithin", true, tArray_copyWithin_getter_tail]);
function tArray_copyWithin_getter_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(holder(0).value, 1); return [r]; }
table.push(["tArray_copyWithin_getter_loop", "Array", "copyWithin", true, tArray_copyWithin_getter_loop]);
function tArray_copyWithin_getter_watched(x: number[], k: any): any { try { const r = x.copyWithin(holder(0).value, 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_copyWithin_getter_watched", "Array", "copyWithin", true, tArray_copyWithin_getter_watched]);
function tArray_copyWithin_own_plain(x: number[], k: any): any { const r = x.copyWithin(alterOwn(x, "copyWithin", 0), 1); return [r]; }
table.push(["tArray_copyWithin_own_plain", "Array", "copyWithin", true, tArray_copyWithin_own_plain]);
function tArray_copyWithin_own_tail(x: number[], k: any): any { return x.copyWithin(alterOwn(x, "copyWithin", 0), 1); }
table.push(["tArray_copyWithin_own_tail", "Array", "copyWithin", true, tArray_copyWithin_own_tail]);
function tArray_copyWithin_own_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(alterOwn(x, "copyWithin", 0), 1); return [r]; }
table.push(["tArray_copyWithin_own_loop", "Array", "copyWithin", true, tArray_copyWithin_own_loop]);
function tArray_copyWithin_own_watched(x: number[], k: any): any { try { const r = x.copyWithin(alterOwn(x, "copyWithin", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_copyWithin_own_watched", "Array", "copyWithin", true, tArray_copyWithin_own_watched]);
function tArray_copyWithin_prototype_plain(x: number[], k: any): any { const r = x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); return [r]; }
table.push(["tArray_copyWithin_prototype_plain", "Array", "copyWithin", true, tArray_copyWithin_prototype_plain]);
function tArray_copyWithin_prototype_tail(x: number[], k: any): any { return x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); }
table.push(["tArray_copyWithin_prototype_tail", "Array", "copyWithin", true, tArray_copyWithin_prototype_tail]);
function tArray_copyWithin_prototype_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); return [r]; }
table.push(["tArray_copyWithin_prototype_loop", "Array", "copyWithin", true, tArray_copyWithin_prototype_loop]);
function tArray_copyWithin_prototype_watched(x: number[], k: any): any { try { const r = x.copyWithin(alterPrototype(x, "copyWithin", 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_copyWithin_prototype_watched", "Array", "copyWithin", true, tArray_copyWithin_prototype_watched]);
function tArray_copyWithin_round_plain(x: number[], k: any): any { const r = x.copyWithin(addAndDelete(x, 0), 1); return [r]; }
table.push(["tArray_copyWithin_round_plain", "Array", "copyWithin", true, tArray_copyWithin_round_plain]);
function tArray_copyWithin_round_tail(x: number[], k: any): any { return x.copyWithin(addAndDelete(x, 0), 1); }
table.push(["tArray_copyWithin_round_tail", "Array", "copyWithin", true, tArray_copyWithin_round_tail]);
function tArray_copyWithin_round_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(addAndDelete(x, 0), 1); return [r]; }
table.push(["tArray_copyWithin_round_loop", "Array", "copyWithin", true, tArray_copyWithin_round_loop]);
function tArray_copyWithin_round_watched(x: number[], k: any): any { try { const r = x.copyWithin(addAndDelete(x, 0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_copyWithin_round_watched", "Array", "copyWithin", true, tArray_copyWithin_round_watched]);
function tArray_copyWithin_conditional_plain(x: number[], k: any): any { const r = x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["tArray_copyWithin_conditional_plain", "Array", "copyWithin", true, tArray_copyWithin_conditional_plain]);
function tArray_copyWithin_conditional_tail(x: number[], k: any): any { return x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); }
table.push(["tArray_copyWithin_conditional_tail", "Array", "copyWithin", true, tArray_copyWithin_conditional_tail]);
function tArray_copyWithin_conditional_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; }
table.push(["tArray_copyWithin_conditional_loop", "Array", "copyWithin", true, tArray_copyWithin_conditional_loop]);
function tArray_copyWithin_conditional_watched(x: number[], k: any): any { try { const r = x.copyWithin((k ? note("yes", 0) : note("no", undefined)), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_copyWithin_conditional_watched", "Array", "copyWithin", true, tArray_copyWithin_conditional_watched]);
function tArray_copyWithin_throws_plain(x: number[], k: any): any { const r = x.copyWithin(fail(0), 1); return [r]; }
table.push(["tArray_copyWithin_throws_plain", "Array", "copyWithin", true, tArray_copyWithin_throws_plain]);
function tArray_copyWithin_throws_tail(x: number[], k: any): any { return x.copyWithin(fail(0), 1); }
table.push(["tArray_copyWithin_throws_tail", "Array", "copyWithin", true, tArray_copyWithin_throws_tail]);
function tArray_copyWithin_throws_loop(x: number[], k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.copyWithin(fail(0), 1); return [r]; }
table.push(["tArray_copyWithin_throws_loop", "Array", "copyWithin", true, tArray_copyWithin_throws_loop]);
function tArray_copyWithin_throws_watched(x: number[], k: any): any { try { const r = x.copyWithin(fail(0), 1); return [r]; } catch (e) { return thrown(e); } }
table.push(["tArray_copyWithin_throws_watched", "Array", "copyWithin", true, tArray_copyWithin_throws_watched]);
function tMap_get_call_plain(x: Map<string, number>, k: any): any { const r = x.get(note("argument", "a")); return [r]; }
table.push(["tMap_get_call_plain", "Map", "get", true, tMap_get_call_plain]);
function tMap_get_call_tail(x: Map<string, number>, k: any): any { return x.get(note("argument", "a")); }
table.push(["tMap_get_call_tail", "Map", "get", true, tMap_get_call_tail]);
function tMap_get_call_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(note("argument", "a")); return [r]; }
table.push(["tMap_get_call_loop", "Map", "get", true, tMap_get_call_loop]);
function tMap_get_call_watched(x: Map<string, number>, k: any): any { try { const r = x.get(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_get_call_watched", "Map", "get", true, tMap_get_call_watched]);
function tMap_get_getter_plain(x: Map<string, number>, k: any): any { const r = x.get(holder("a").value); return [r]; }
table.push(["tMap_get_getter_plain", "Map", "get", true, tMap_get_getter_plain]);
function tMap_get_getter_tail(x: Map<string, number>, k: any): any { return x.get(holder("a").value); }
table.push(["tMap_get_getter_tail", "Map", "get", true, tMap_get_getter_tail]);
function tMap_get_getter_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(holder("a").value); return [r]; }
table.push(["tMap_get_getter_loop", "Map", "get", true, tMap_get_getter_loop]);
function tMap_get_getter_watched(x: Map<string, number>, k: any): any { try { const r = x.get(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_get_getter_watched", "Map", "get", true, tMap_get_getter_watched]);
function tMap_get_own_plain(x: Map<string, number>, k: any): any { const r = x.get(alterOwn(x, "get", "a")); return [r]; }
table.push(["tMap_get_own_plain", "Map", "get", true, tMap_get_own_plain]);
function tMap_get_own_tail(x: Map<string, number>, k: any): any { return x.get(alterOwn(x, "get", "a")); }
table.push(["tMap_get_own_tail", "Map", "get", true, tMap_get_own_tail]);
function tMap_get_own_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(alterOwn(x, "get", "a")); return [r]; }
table.push(["tMap_get_own_loop", "Map", "get", true, tMap_get_own_loop]);
function tMap_get_own_watched(x: Map<string, number>, k: any): any { try { const r = x.get(alterOwn(x, "get", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_get_own_watched", "Map", "get", true, tMap_get_own_watched]);
function tMap_get_prototype_plain(x: Map<string, number>, k: any): any { const r = x.get(alterPrototype(x, "get", "a")); return [r]; }
table.push(["tMap_get_prototype_plain", "Map", "get", true, tMap_get_prototype_plain]);
function tMap_get_prototype_tail(x: Map<string, number>, k: any): any { return x.get(alterPrototype(x, "get", "a")); }
table.push(["tMap_get_prototype_tail", "Map", "get", true, tMap_get_prototype_tail]);
function tMap_get_prototype_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(alterPrototype(x, "get", "a")); return [r]; }
table.push(["tMap_get_prototype_loop", "Map", "get", true, tMap_get_prototype_loop]);
function tMap_get_prototype_watched(x: Map<string, number>, k: any): any { try { const r = x.get(alterPrototype(x, "get", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_get_prototype_watched", "Map", "get", true, tMap_get_prototype_watched]);
function tMap_get_round_plain(x: Map<string, number>, k: any): any { const r = x.get(addAndDelete(x, "a")); return [r]; }
table.push(["tMap_get_round_plain", "Map", "get", true, tMap_get_round_plain]);
function tMap_get_round_tail(x: Map<string, number>, k: any): any { return x.get(addAndDelete(x, "a")); }
table.push(["tMap_get_round_tail", "Map", "get", true, tMap_get_round_tail]);
function tMap_get_round_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(addAndDelete(x, "a")); return [r]; }
table.push(["tMap_get_round_loop", "Map", "get", true, tMap_get_round_loop]);
function tMap_get_round_watched(x: Map<string, number>, k: any): any { try { const r = x.get(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_get_round_watched", "Map", "get", true, tMap_get_round_watched]);
function tMap_get_conditional_plain(x: Map<string, number>, k: any): any { const r = x.get((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tMap_get_conditional_plain", "Map", "get", true, tMap_get_conditional_plain]);
function tMap_get_conditional_tail(x: Map<string, number>, k: any): any { return x.get((k ? note("yes", "a") : note("no", undefined))); }
table.push(["tMap_get_conditional_tail", "Map", "get", true, tMap_get_conditional_tail]);
function tMap_get_conditional_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tMap_get_conditional_loop", "Map", "get", true, tMap_get_conditional_loop]);
function tMap_get_conditional_watched(x: Map<string, number>, k: any): any { try { const r = x.get((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_get_conditional_watched", "Map", "get", true, tMap_get_conditional_watched]);
function tMap_get_throws_plain(x: Map<string, number>, k: any): any { const r = x.get(fail("a")); return [r]; }
table.push(["tMap_get_throws_plain", "Map", "get", true, tMap_get_throws_plain]);
function tMap_get_throws_tail(x: Map<string, number>, k: any): any { return x.get(fail("a")); }
table.push(["tMap_get_throws_tail", "Map", "get", true, tMap_get_throws_tail]);
function tMap_get_throws_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.get(fail("a")); return [r]; }
table.push(["tMap_get_throws_loop", "Map", "get", true, tMap_get_throws_loop]);
function tMap_get_throws_watched(x: Map<string, number>, k: any): any { try { const r = x.get(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_get_throws_watched", "Map", "get", true, tMap_get_throws_watched]);
function tMap_has_call_plain(x: Map<string, number>, k: any): any { const r = x.has(note("argument", "a")); return [r]; }
table.push(["tMap_has_call_plain", "Map", "has", true, tMap_has_call_plain]);
function tMap_has_call_tail(x: Map<string, number>, k: any): any { return x.has(note("argument", "a")); }
table.push(["tMap_has_call_tail", "Map", "has", true, tMap_has_call_tail]);
function tMap_has_call_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(note("argument", "a")); return [r]; }
table.push(["tMap_has_call_loop", "Map", "has", true, tMap_has_call_loop]);
function tMap_has_call_watched(x: Map<string, number>, k: any): any { try { const r = x.has(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_has_call_watched", "Map", "has", true, tMap_has_call_watched]);
function tMap_has_getter_plain(x: Map<string, number>, k: any): any { const r = x.has(holder("a").value); return [r]; }
table.push(["tMap_has_getter_plain", "Map", "has", true, tMap_has_getter_plain]);
function tMap_has_getter_tail(x: Map<string, number>, k: any): any { return x.has(holder("a").value); }
table.push(["tMap_has_getter_tail", "Map", "has", true, tMap_has_getter_tail]);
function tMap_has_getter_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(holder("a").value); return [r]; }
table.push(["tMap_has_getter_loop", "Map", "has", true, tMap_has_getter_loop]);
function tMap_has_getter_watched(x: Map<string, number>, k: any): any { try { const r = x.has(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_has_getter_watched", "Map", "has", true, tMap_has_getter_watched]);
function tMap_has_own_plain(x: Map<string, number>, k: any): any { const r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["tMap_has_own_plain", "Map", "has", true, tMap_has_own_plain]);
function tMap_has_own_tail(x: Map<string, number>, k: any): any { return x.has(alterOwn(x, "has", "a")); }
table.push(["tMap_has_own_tail", "Map", "has", true, tMap_has_own_tail]);
function tMap_has_own_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["tMap_has_own_loop", "Map", "has", true, tMap_has_own_loop]);
function tMap_has_own_watched(x: Map<string, number>, k: any): any { try { const r = x.has(alterOwn(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_has_own_watched", "Map", "has", true, tMap_has_own_watched]);
function tMap_has_prototype_plain(x: Map<string, number>, k: any): any { const r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["tMap_has_prototype_plain", "Map", "has", true, tMap_has_prototype_plain]);
function tMap_has_prototype_tail(x: Map<string, number>, k: any): any { return x.has(alterPrototype(x, "has", "a")); }
table.push(["tMap_has_prototype_tail", "Map", "has", true, tMap_has_prototype_tail]);
function tMap_has_prototype_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["tMap_has_prototype_loop", "Map", "has", true, tMap_has_prototype_loop]);
function tMap_has_prototype_watched(x: Map<string, number>, k: any): any { try { const r = x.has(alterPrototype(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_has_prototype_watched", "Map", "has", true, tMap_has_prototype_watched]);
function tMap_has_round_plain(x: Map<string, number>, k: any): any { const r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["tMap_has_round_plain", "Map", "has", true, tMap_has_round_plain]);
function tMap_has_round_tail(x: Map<string, number>, k: any): any { return x.has(addAndDelete(x, "a")); }
table.push(["tMap_has_round_tail", "Map", "has", true, tMap_has_round_tail]);
function tMap_has_round_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["tMap_has_round_loop", "Map", "has", true, tMap_has_round_loop]);
function tMap_has_round_watched(x: Map<string, number>, k: any): any { try { const r = x.has(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_has_round_watched", "Map", "has", true, tMap_has_round_watched]);
function tMap_has_conditional_plain(x: Map<string, number>, k: any): any { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tMap_has_conditional_plain", "Map", "has", true, tMap_has_conditional_plain]);
function tMap_has_conditional_tail(x: Map<string, number>, k: any): any { return x.has((k ? note("yes", "a") : note("no", undefined))); }
table.push(["tMap_has_conditional_tail", "Map", "has", true, tMap_has_conditional_tail]);
function tMap_has_conditional_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tMap_has_conditional_loop", "Map", "has", true, tMap_has_conditional_loop]);
function tMap_has_conditional_watched(x: Map<string, number>, k: any): any { try { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_has_conditional_watched", "Map", "has", true, tMap_has_conditional_watched]);
function tMap_has_throws_plain(x: Map<string, number>, k: any): any { const r = x.has(fail("a")); return [r]; }
table.push(["tMap_has_throws_plain", "Map", "has", true, tMap_has_throws_plain]);
function tMap_has_throws_tail(x: Map<string, number>, k: any): any { return x.has(fail("a")); }
table.push(["tMap_has_throws_tail", "Map", "has", true, tMap_has_throws_tail]);
function tMap_has_throws_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(fail("a")); return [r]; }
table.push(["tMap_has_throws_loop", "Map", "has", true, tMap_has_throws_loop]);
function tMap_has_throws_watched(x: Map<string, number>, k: any): any { try { const r = x.has(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_has_throws_watched", "Map", "has", true, tMap_has_throws_watched]);
function tMap_set_call_plain(x: Map<string, number>, k: any): any { const r = x.set(note("argument", "c"), 3); return [r]; }
table.push(["tMap_set_call_plain", "Map", "set", true, tMap_set_call_plain]);
function tMap_set_call_tail(x: Map<string, number>, k: any): any { return x.set(note("argument", "c"), 3); }
table.push(["tMap_set_call_tail", "Map", "set", true, tMap_set_call_tail]);
function tMap_set_call_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(note("argument", "c"), 3); return [r]; }
table.push(["tMap_set_call_loop", "Map", "set", true, tMap_set_call_loop]);
function tMap_set_call_watched(x: Map<string, number>, k: any): any { try { const r = x.set(note("argument", "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_set_call_watched", "Map", "set", true, tMap_set_call_watched]);
function tMap_set_getter_plain(x: Map<string, number>, k: any): any { const r = x.set(holder("c").value, 3); return [r]; }
table.push(["tMap_set_getter_plain", "Map", "set", true, tMap_set_getter_plain]);
function tMap_set_getter_tail(x: Map<string, number>, k: any): any { return x.set(holder("c").value, 3); }
table.push(["tMap_set_getter_tail", "Map", "set", true, tMap_set_getter_tail]);
function tMap_set_getter_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(holder("c").value, 3); return [r]; }
table.push(["tMap_set_getter_loop", "Map", "set", true, tMap_set_getter_loop]);
function tMap_set_getter_watched(x: Map<string, number>, k: any): any { try { const r = x.set(holder("c").value, 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_set_getter_watched", "Map", "set", true, tMap_set_getter_watched]);
function tMap_set_own_plain(x: Map<string, number>, k: any): any { const r = x.set(alterOwn(x, "set", "c"), 3); return [r]; }
table.push(["tMap_set_own_plain", "Map", "set", true, tMap_set_own_plain]);
function tMap_set_own_tail(x: Map<string, number>, k: any): any { return x.set(alterOwn(x, "set", "c"), 3); }
table.push(["tMap_set_own_tail", "Map", "set", true, tMap_set_own_tail]);
function tMap_set_own_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(alterOwn(x, "set", "c"), 3); return [r]; }
table.push(["tMap_set_own_loop", "Map", "set", true, tMap_set_own_loop]);
function tMap_set_own_watched(x: Map<string, number>, k: any): any { try { const r = x.set(alterOwn(x, "set", "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_set_own_watched", "Map", "set", true, tMap_set_own_watched]);
function tMap_set_prototype_plain(x: Map<string, number>, k: any): any { const r = x.set(alterPrototype(x, "set", "c"), 3); return [r]; }
table.push(["tMap_set_prototype_plain", "Map", "set", true, tMap_set_prototype_plain]);
function tMap_set_prototype_tail(x: Map<string, number>, k: any): any { return x.set(alterPrototype(x, "set", "c"), 3); }
table.push(["tMap_set_prototype_tail", "Map", "set", true, tMap_set_prototype_tail]);
function tMap_set_prototype_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(alterPrototype(x, "set", "c"), 3); return [r]; }
table.push(["tMap_set_prototype_loop", "Map", "set", true, tMap_set_prototype_loop]);
function tMap_set_prototype_watched(x: Map<string, number>, k: any): any { try { const r = x.set(alterPrototype(x, "set", "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_set_prototype_watched", "Map", "set", true, tMap_set_prototype_watched]);
function tMap_set_round_plain(x: Map<string, number>, k: any): any { const r = x.set(addAndDelete(x, "c"), 3); return [r]; }
table.push(["tMap_set_round_plain", "Map", "set", true, tMap_set_round_plain]);
function tMap_set_round_tail(x: Map<string, number>, k: any): any { return x.set(addAndDelete(x, "c"), 3); }
table.push(["tMap_set_round_tail", "Map", "set", true, tMap_set_round_tail]);
function tMap_set_round_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(addAndDelete(x, "c"), 3); return [r]; }
table.push(["tMap_set_round_loop", "Map", "set", true, tMap_set_round_loop]);
function tMap_set_round_watched(x: Map<string, number>, k: any): any { try { const r = x.set(addAndDelete(x, "c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_set_round_watched", "Map", "set", true, tMap_set_round_watched]);
function tMap_set_conditional_plain(x: Map<string, number>, k: any): any { const r = x.set((k ? note("yes", "c") : note("no", undefined)), 3); return [r]; }
table.push(["tMap_set_conditional_plain", "Map", "set", true, tMap_set_conditional_plain]);
function tMap_set_conditional_tail(x: Map<string, number>, k: any): any { return x.set((k ? note("yes", "c") : note("no", undefined)), 3); }
table.push(["tMap_set_conditional_tail", "Map", "set", true, tMap_set_conditional_tail]);
function tMap_set_conditional_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set((k ? note("yes", "c") : note("no", undefined)), 3); return [r]; }
table.push(["tMap_set_conditional_loop", "Map", "set", true, tMap_set_conditional_loop]);
function tMap_set_conditional_watched(x: Map<string, number>, k: any): any { try { const r = x.set((k ? note("yes", "c") : note("no", undefined)), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_set_conditional_watched", "Map", "set", true, tMap_set_conditional_watched]);
function tMap_set_throws_plain(x: Map<string, number>, k: any): any { const r = x.set(fail("c"), 3); return [r]; }
table.push(["tMap_set_throws_plain", "Map", "set", true, tMap_set_throws_plain]);
function tMap_set_throws_tail(x: Map<string, number>, k: any): any { return x.set(fail("c"), 3); }
table.push(["tMap_set_throws_tail", "Map", "set", true, tMap_set_throws_tail]);
function tMap_set_throws_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.set(fail("c"), 3); return [r]; }
table.push(["tMap_set_throws_loop", "Map", "set", true, tMap_set_throws_loop]);
function tMap_set_throws_watched(x: Map<string, number>, k: any): any { try { const r = x.set(fail("c"), 3); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_set_throws_watched", "Map", "set", true, tMap_set_throws_watched]);
function tMap_delete_call_plain(x: Map<string, number>, k: any): any { const r = x.delete(note("argument", "a")); return [r]; }
table.push(["tMap_delete_call_plain", "Map", "delete", true, tMap_delete_call_plain]);
function tMap_delete_call_tail(x: Map<string, number>, k: any): any { return x.delete(note("argument", "a")); }
table.push(["tMap_delete_call_tail", "Map", "delete", true, tMap_delete_call_tail]);
function tMap_delete_call_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(note("argument", "a")); return [r]; }
table.push(["tMap_delete_call_loop", "Map", "delete", true, tMap_delete_call_loop]);
function tMap_delete_call_watched(x: Map<string, number>, k: any): any { try { const r = x.delete(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_delete_call_watched", "Map", "delete", true, tMap_delete_call_watched]);
function tMap_delete_getter_plain(x: Map<string, number>, k: any): any { const r = x.delete(holder("a").value); return [r]; }
table.push(["tMap_delete_getter_plain", "Map", "delete", true, tMap_delete_getter_plain]);
function tMap_delete_getter_tail(x: Map<string, number>, k: any): any { return x.delete(holder("a").value); }
table.push(["tMap_delete_getter_tail", "Map", "delete", true, tMap_delete_getter_tail]);
function tMap_delete_getter_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(holder("a").value); return [r]; }
table.push(["tMap_delete_getter_loop", "Map", "delete", true, tMap_delete_getter_loop]);
function tMap_delete_getter_watched(x: Map<string, number>, k: any): any { try { const r = x.delete(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_delete_getter_watched", "Map", "delete", true, tMap_delete_getter_watched]);
function tMap_delete_own_plain(x: Map<string, number>, k: any): any { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["tMap_delete_own_plain", "Map", "delete", true, tMap_delete_own_plain]);
function tMap_delete_own_tail(x: Map<string, number>, k: any): any { return x.delete(alterOwn(x, "delete", "a")); }
table.push(["tMap_delete_own_tail", "Map", "delete", true, tMap_delete_own_tail]);
function tMap_delete_own_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["tMap_delete_own_loop", "Map", "delete", true, tMap_delete_own_loop]);
function tMap_delete_own_watched(x: Map<string, number>, k: any): any { try { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_delete_own_watched", "Map", "delete", true, tMap_delete_own_watched]);
function tMap_delete_prototype_plain(x: Map<string, number>, k: any): any { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["tMap_delete_prototype_plain", "Map", "delete", true, tMap_delete_prototype_plain]);
function tMap_delete_prototype_tail(x: Map<string, number>, k: any): any { return x.delete(alterPrototype(x, "delete", "a")); }
table.push(["tMap_delete_prototype_tail", "Map", "delete", true, tMap_delete_prototype_tail]);
function tMap_delete_prototype_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["tMap_delete_prototype_loop", "Map", "delete", true, tMap_delete_prototype_loop]);
function tMap_delete_prototype_watched(x: Map<string, number>, k: any): any { try { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_delete_prototype_watched", "Map", "delete", true, tMap_delete_prototype_watched]);
function tMap_delete_round_plain(x: Map<string, number>, k: any): any { const r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["tMap_delete_round_plain", "Map", "delete", true, tMap_delete_round_plain]);
function tMap_delete_round_tail(x: Map<string, number>, k: any): any { return x.delete(addAndDelete(x, "a")); }
table.push(["tMap_delete_round_tail", "Map", "delete", true, tMap_delete_round_tail]);
function tMap_delete_round_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["tMap_delete_round_loop", "Map", "delete", true, tMap_delete_round_loop]);
function tMap_delete_round_watched(x: Map<string, number>, k: any): any { try { const r = x.delete(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_delete_round_watched", "Map", "delete", true, tMap_delete_round_watched]);
function tMap_delete_conditional_plain(x: Map<string, number>, k: any): any { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tMap_delete_conditional_plain", "Map", "delete", true, tMap_delete_conditional_plain]);
function tMap_delete_conditional_tail(x: Map<string, number>, k: any): any { return x.delete((k ? note("yes", "a") : note("no", undefined))); }
table.push(["tMap_delete_conditional_tail", "Map", "delete", true, tMap_delete_conditional_tail]);
function tMap_delete_conditional_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tMap_delete_conditional_loop", "Map", "delete", true, tMap_delete_conditional_loop]);
function tMap_delete_conditional_watched(x: Map<string, number>, k: any): any { try { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_delete_conditional_watched", "Map", "delete", true, tMap_delete_conditional_watched]);
function tMap_delete_throws_plain(x: Map<string, number>, k: any): any { const r = x.delete(fail("a")); return [r]; }
table.push(["tMap_delete_throws_plain", "Map", "delete", true, tMap_delete_throws_plain]);
function tMap_delete_throws_tail(x: Map<string, number>, k: any): any { return x.delete(fail("a")); }
table.push(["tMap_delete_throws_tail", "Map", "delete", true, tMap_delete_throws_tail]);
function tMap_delete_throws_loop(x: Map<string, number>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(fail("a")); return [r]; }
table.push(["tMap_delete_throws_loop", "Map", "delete", true, tMap_delete_throws_loop]);
function tMap_delete_throws_watched(x: Map<string, number>, k: any): any { try { const r = x.delete(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tMap_delete_throws_watched", "Map", "delete", true, tMap_delete_throws_watched]);
function tSet_has_call_plain(x: Set<string>, k: any): any { const r = x.has(note("argument", "a")); return [r]; }
table.push(["tSet_has_call_plain", "Set", "has", true, tSet_has_call_plain]);
function tSet_has_call_tail(x: Set<string>, k: any): any { return x.has(note("argument", "a")); }
table.push(["tSet_has_call_tail", "Set", "has", true, tSet_has_call_tail]);
function tSet_has_call_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(note("argument", "a")); return [r]; }
table.push(["tSet_has_call_loop", "Set", "has", true, tSet_has_call_loop]);
function tSet_has_call_watched(x: Set<string>, k: any): any { try { const r = x.has(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_has_call_watched", "Set", "has", true, tSet_has_call_watched]);
function tSet_has_getter_plain(x: Set<string>, k: any): any { const r = x.has(holder("a").value); return [r]; }
table.push(["tSet_has_getter_plain", "Set", "has", true, tSet_has_getter_plain]);
function tSet_has_getter_tail(x: Set<string>, k: any): any { return x.has(holder("a").value); }
table.push(["tSet_has_getter_tail", "Set", "has", true, tSet_has_getter_tail]);
function tSet_has_getter_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(holder("a").value); return [r]; }
table.push(["tSet_has_getter_loop", "Set", "has", true, tSet_has_getter_loop]);
function tSet_has_getter_watched(x: Set<string>, k: any): any { try { const r = x.has(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_has_getter_watched", "Set", "has", true, tSet_has_getter_watched]);
function tSet_has_own_plain(x: Set<string>, k: any): any { const r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["tSet_has_own_plain", "Set", "has", true, tSet_has_own_plain]);
function tSet_has_own_tail(x: Set<string>, k: any): any { return x.has(alterOwn(x, "has", "a")); }
table.push(["tSet_has_own_tail", "Set", "has", true, tSet_has_own_tail]);
function tSet_has_own_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterOwn(x, "has", "a")); return [r]; }
table.push(["tSet_has_own_loop", "Set", "has", true, tSet_has_own_loop]);
function tSet_has_own_watched(x: Set<string>, k: any): any { try { const r = x.has(alterOwn(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_has_own_watched", "Set", "has", true, tSet_has_own_watched]);
function tSet_has_prototype_plain(x: Set<string>, k: any): any { const r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["tSet_has_prototype_plain", "Set", "has", true, tSet_has_prototype_plain]);
function tSet_has_prototype_tail(x: Set<string>, k: any): any { return x.has(alterPrototype(x, "has", "a")); }
table.push(["tSet_has_prototype_tail", "Set", "has", true, tSet_has_prototype_tail]);
function tSet_has_prototype_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(alterPrototype(x, "has", "a")); return [r]; }
table.push(["tSet_has_prototype_loop", "Set", "has", true, tSet_has_prototype_loop]);
function tSet_has_prototype_watched(x: Set<string>, k: any): any { try { const r = x.has(alterPrototype(x, "has", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_has_prototype_watched", "Set", "has", true, tSet_has_prototype_watched]);
function tSet_has_round_plain(x: Set<string>, k: any): any { const r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["tSet_has_round_plain", "Set", "has", true, tSet_has_round_plain]);
function tSet_has_round_tail(x: Set<string>, k: any): any { return x.has(addAndDelete(x, "a")); }
table.push(["tSet_has_round_tail", "Set", "has", true, tSet_has_round_tail]);
function tSet_has_round_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(addAndDelete(x, "a")); return [r]; }
table.push(["tSet_has_round_loop", "Set", "has", true, tSet_has_round_loop]);
function tSet_has_round_watched(x: Set<string>, k: any): any { try { const r = x.has(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_has_round_watched", "Set", "has", true, tSet_has_round_watched]);
function tSet_has_conditional_plain(x: Set<string>, k: any): any { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tSet_has_conditional_plain", "Set", "has", true, tSet_has_conditional_plain]);
function tSet_has_conditional_tail(x: Set<string>, k: any): any { return x.has((k ? note("yes", "a") : note("no", undefined))); }
table.push(["tSet_has_conditional_tail", "Set", "has", true, tSet_has_conditional_tail]);
function tSet_has_conditional_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tSet_has_conditional_loop", "Set", "has", true, tSet_has_conditional_loop]);
function tSet_has_conditional_watched(x: Set<string>, k: any): any { try { const r = x.has((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_has_conditional_watched", "Set", "has", true, tSet_has_conditional_watched]);
function tSet_has_throws_plain(x: Set<string>, k: any): any { const r = x.has(fail("a")); return [r]; }
table.push(["tSet_has_throws_plain", "Set", "has", true, tSet_has_throws_plain]);
function tSet_has_throws_tail(x: Set<string>, k: any): any { return x.has(fail("a")); }
table.push(["tSet_has_throws_tail", "Set", "has", true, tSet_has_throws_tail]);
function tSet_has_throws_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.has(fail("a")); return [r]; }
table.push(["tSet_has_throws_loop", "Set", "has", true, tSet_has_throws_loop]);
function tSet_has_throws_watched(x: Set<string>, k: any): any { try { const r = x.has(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_has_throws_watched", "Set", "has", true, tSet_has_throws_watched]);
function tSet_add_call_plain(x: Set<string>, k: any): any { const r = x.add(note("argument", "c")); return [r]; }
table.push(["tSet_add_call_plain", "Set", "add", true, tSet_add_call_plain]);
function tSet_add_call_tail(x: Set<string>, k: any): any { return x.add(note("argument", "c")); }
table.push(["tSet_add_call_tail", "Set", "add", true, tSet_add_call_tail]);
function tSet_add_call_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(note("argument", "c")); return [r]; }
table.push(["tSet_add_call_loop", "Set", "add", true, tSet_add_call_loop]);
function tSet_add_call_watched(x: Set<string>, k: any): any { try { const r = x.add(note("argument", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_add_call_watched", "Set", "add", true, tSet_add_call_watched]);
function tSet_add_getter_plain(x: Set<string>, k: any): any { const r = x.add(holder("c").value); return [r]; }
table.push(["tSet_add_getter_plain", "Set", "add", true, tSet_add_getter_plain]);
function tSet_add_getter_tail(x: Set<string>, k: any): any { return x.add(holder("c").value); }
table.push(["tSet_add_getter_tail", "Set", "add", true, tSet_add_getter_tail]);
function tSet_add_getter_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(holder("c").value); return [r]; }
table.push(["tSet_add_getter_loop", "Set", "add", true, tSet_add_getter_loop]);
function tSet_add_getter_watched(x: Set<string>, k: any): any { try { const r = x.add(holder("c").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_add_getter_watched", "Set", "add", true, tSet_add_getter_watched]);
function tSet_add_own_plain(x: Set<string>, k: any): any { const r = x.add(alterOwn(x, "add", "c")); return [r]; }
table.push(["tSet_add_own_plain", "Set", "add", true, tSet_add_own_plain]);
function tSet_add_own_tail(x: Set<string>, k: any): any { return x.add(alterOwn(x, "add", "c")); }
table.push(["tSet_add_own_tail", "Set", "add", true, tSet_add_own_tail]);
function tSet_add_own_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(alterOwn(x, "add", "c")); return [r]; }
table.push(["tSet_add_own_loop", "Set", "add", true, tSet_add_own_loop]);
function tSet_add_own_watched(x: Set<string>, k: any): any { try { const r = x.add(alterOwn(x, "add", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_add_own_watched", "Set", "add", true, tSet_add_own_watched]);
function tSet_add_prototype_plain(x: Set<string>, k: any): any { const r = x.add(alterPrototype(x, "add", "c")); return [r]; }
table.push(["tSet_add_prototype_plain", "Set", "add", true, tSet_add_prototype_plain]);
function tSet_add_prototype_tail(x: Set<string>, k: any): any { return x.add(alterPrototype(x, "add", "c")); }
table.push(["tSet_add_prototype_tail", "Set", "add", true, tSet_add_prototype_tail]);
function tSet_add_prototype_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(alterPrototype(x, "add", "c")); return [r]; }
table.push(["tSet_add_prototype_loop", "Set", "add", true, tSet_add_prototype_loop]);
function tSet_add_prototype_watched(x: Set<string>, k: any): any { try { const r = x.add(alterPrototype(x, "add", "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_add_prototype_watched", "Set", "add", true, tSet_add_prototype_watched]);
function tSet_add_round_plain(x: Set<string>, k: any): any { const r = x.add(addAndDelete(x, "c")); return [r]; }
table.push(["tSet_add_round_plain", "Set", "add", true, tSet_add_round_plain]);
function tSet_add_round_tail(x: Set<string>, k: any): any { return x.add(addAndDelete(x, "c")); }
table.push(["tSet_add_round_tail", "Set", "add", true, tSet_add_round_tail]);
function tSet_add_round_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(addAndDelete(x, "c")); return [r]; }
table.push(["tSet_add_round_loop", "Set", "add", true, tSet_add_round_loop]);
function tSet_add_round_watched(x: Set<string>, k: any): any { try { const r = x.add(addAndDelete(x, "c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_add_round_watched", "Set", "add", true, tSet_add_round_watched]);
function tSet_add_conditional_plain(x: Set<string>, k: any): any { const r = x.add((k ? note("yes", "c") : note("no", undefined))); return [r]; }
table.push(["tSet_add_conditional_plain", "Set", "add", true, tSet_add_conditional_plain]);
function tSet_add_conditional_tail(x: Set<string>, k: any): any { return x.add((k ? note("yes", "c") : note("no", undefined))); }
table.push(["tSet_add_conditional_tail", "Set", "add", true, tSet_add_conditional_tail]);
function tSet_add_conditional_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add((k ? note("yes", "c") : note("no", undefined))); return [r]; }
table.push(["tSet_add_conditional_loop", "Set", "add", true, tSet_add_conditional_loop]);
function tSet_add_conditional_watched(x: Set<string>, k: any): any { try { const r = x.add((k ? note("yes", "c") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_add_conditional_watched", "Set", "add", true, tSet_add_conditional_watched]);
function tSet_add_throws_plain(x: Set<string>, k: any): any { const r = x.add(fail("c")); return [r]; }
table.push(["tSet_add_throws_plain", "Set", "add", true, tSet_add_throws_plain]);
function tSet_add_throws_tail(x: Set<string>, k: any): any { return x.add(fail("c")); }
table.push(["tSet_add_throws_tail", "Set", "add", true, tSet_add_throws_tail]);
function tSet_add_throws_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.add(fail("c")); return [r]; }
table.push(["tSet_add_throws_loop", "Set", "add", true, tSet_add_throws_loop]);
function tSet_add_throws_watched(x: Set<string>, k: any): any { try { const r = x.add(fail("c")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_add_throws_watched", "Set", "add", true, tSet_add_throws_watched]);
function tSet_delete_call_plain(x: Set<string>, k: any): any { const r = x.delete(note("argument", "a")); return [r]; }
table.push(["tSet_delete_call_plain", "Set", "delete", true, tSet_delete_call_plain]);
function tSet_delete_call_tail(x: Set<string>, k: any): any { return x.delete(note("argument", "a")); }
table.push(["tSet_delete_call_tail", "Set", "delete", true, tSet_delete_call_tail]);
function tSet_delete_call_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(note("argument", "a")); return [r]; }
table.push(["tSet_delete_call_loop", "Set", "delete", true, tSet_delete_call_loop]);
function tSet_delete_call_watched(x: Set<string>, k: any): any { try { const r = x.delete(note("argument", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_delete_call_watched", "Set", "delete", true, tSet_delete_call_watched]);
function tSet_delete_getter_plain(x: Set<string>, k: any): any { const r = x.delete(holder("a").value); return [r]; }
table.push(["tSet_delete_getter_plain", "Set", "delete", true, tSet_delete_getter_plain]);
function tSet_delete_getter_tail(x: Set<string>, k: any): any { return x.delete(holder("a").value); }
table.push(["tSet_delete_getter_tail", "Set", "delete", true, tSet_delete_getter_tail]);
function tSet_delete_getter_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(holder("a").value); return [r]; }
table.push(["tSet_delete_getter_loop", "Set", "delete", true, tSet_delete_getter_loop]);
function tSet_delete_getter_watched(x: Set<string>, k: any): any { try { const r = x.delete(holder("a").value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_delete_getter_watched", "Set", "delete", true, tSet_delete_getter_watched]);
function tSet_delete_own_plain(x: Set<string>, k: any): any { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["tSet_delete_own_plain", "Set", "delete", true, tSet_delete_own_plain]);
function tSet_delete_own_tail(x: Set<string>, k: any): any { return x.delete(alterOwn(x, "delete", "a")); }
table.push(["tSet_delete_own_tail", "Set", "delete", true, tSet_delete_own_tail]);
function tSet_delete_own_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterOwn(x, "delete", "a")); return [r]; }
table.push(["tSet_delete_own_loop", "Set", "delete", true, tSet_delete_own_loop]);
function tSet_delete_own_watched(x: Set<string>, k: any): any { try { const r = x.delete(alterOwn(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_delete_own_watched", "Set", "delete", true, tSet_delete_own_watched]);
function tSet_delete_prototype_plain(x: Set<string>, k: any): any { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["tSet_delete_prototype_plain", "Set", "delete", true, tSet_delete_prototype_plain]);
function tSet_delete_prototype_tail(x: Set<string>, k: any): any { return x.delete(alterPrototype(x, "delete", "a")); }
table.push(["tSet_delete_prototype_tail", "Set", "delete", true, tSet_delete_prototype_tail]);
function tSet_delete_prototype_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(alterPrototype(x, "delete", "a")); return [r]; }
table.push(["tSet_delete_prototype_loop", "Set", "delete", true, tSet_delete_prototype_loop]);
function tSet_delete_prototype_watched(x: Set<string>, k: any): any { try { const r = x.delete(alterPrototype(x, "delete", "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_delete_prototype_watched", "Set", "delete", true, tSet_delete_prototype_watched]);
function tSet_delete_round_plain(x: Set<string>, k: any): any { const r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["tSet_delete_round_plain", "Set", "delete", true, tSet_delete_round_plain]);
function tSet_delete_round_tail(x: Set<string>, k: any): any { return x.delete(addAndDelete(x, "a")); }
table.push(["tSet_delete_round_tail", "Set", "delete", true, tSet_delete_round_tail]);
function tSet_delete_round_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(addAndDelete(x, "a")); return [r]; }
table.push(["tSet_delete_round_loop", "Set", "delete", true, tSet_delete_round_loop]);
function tSet_delete_round_watched(x: Set<string>, k: any): any { try { const r = x.delete(addAndDelete(x, "a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_delete_round_watched", "Set", "delete", true, tSet_delete_round_watched]);
function tSet_delete_conditional_plain(x: Set<string>, k: any): any { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tSet_delete_conditional_plain", "Set", "delete", true, tSet_delete_conditional_plain]);
function tSet_delete_conditional_tail(x: Set<string>, k: any): any { return x.delete((k ? note("yes", "a") : note("no", undefined))); }
table.push(["tSet_delete_conditional_tail", "Set", "delete", true, tSet_delete_conditional_tail]);
function tSet_delete_conditional_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; }
table.push(["tSet_delete_conditional_loop", "Set", "delete", true, tSet_delete_conditional_loop]);
function tSet_delete_conditional_watched(x: Set<string>, k: any): any { try { const r = x.delete((k ? note("yes", "a") : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_delete_conditional_watched", "Set", "delete", true, tSet_delete_conditional_watched]);
function tSet_delete_throws_plain(x: Set<string>, k: any): any { const r = x.delete(fail("a")); return [r]; }
table.push(["tSet_delete_throws_plain", "Set", "delete", true, tSet_delete_throws_plain]);
function tSet_delete_throws_tail(x: Set<string>, k: any): any { return x.delete(fail("a")); }
table.push(["tSet_delete_throws_tail", "Set", "delete", true, tSet_delete_throws_tail]);
function tSet_delete_throws_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.delete(fail("a")); return [r]; }
table.push(["tSet_delete_throws_loop", "Set", "delete", true, tSet_delete_throws_loop]);
function tSet_delete_throws_watched(x: Set<string>, k: any): any { try { const r = x.delete(fail("a")); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_delete_throws_watched", "Set", "delete", true, tSet_delete_throws_watched]);
function tSet_union_call_plain(x: Set<string>, k: any): any { const r = x.union(note("argument", other)); return [r]; }
table.push(["tSet_union_call_plain", "Set", "union", true, tSet_union_call_plain]);
function tSet_union_call_tail(x: Set<string>, k: any): any { return x.union(note("argument", other)); }
table.push(["tSet_union_call_tail", "Set", "union", true, tSet_union_call_tail]);
function tSet_union_call_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(note("argument", other)); return [r]; }
table.push(["tSet_union_call_loop", "Set", "union", true, tSet_union_call_loop]);
function tSet_union_call_watched(x: Set<string>, k: any): any { try { const r = x.union(note("argument", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_union_call_watched", "Set", "union", true, tSet_union_call_watched]);
function tSet_union_getter_plain(x: Set<string>, k: any): any { const r = x.union(holder(other).value); return [r]; }
table.push(["tSet_union_getter_plain", "Set", "union", true, tSet_union_getter_plain]);
function tSet_union_getter_tail(x: Set<string>, k: any): any { return x.union(holder(other).value); }
table.push(["tSet_union_getter_tail", "Set", "union", true, tSet_union_getter_tail]);
function tSet_union_getter_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(holder(other).value); return [r]; }
table.push(["tSet_union_getter_loop", "Set", "union", true, tSet_union_getter_loop]);
function tSet_union_getter_watched(x: Set<string>, k: any): any { try { const r = x.union(holder(other).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_union_getter_watched", "Set", "union", true, tSet_union_getter_watched]);
function tSet_union_own_plain(x: Set<string>, k: any): any { const r = x.union(alterOwn(x, "union", other)); return [r]; }
table.push(["tSet_union_own_plain", "Set", "union", true, tSet_union_own_plain]);
function tSet_union_own_tail(x: Set<string>, k: any): any { return x.union(alterOwn(x, "union", other)); }
table.push(["tSet_union_own_tail", "Set", "union", true, tSet_union_own_tail]);
function tSet_union_own_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(alterOwn(x, "union", other)); return [r]; }
table.push(["tSet_union_own_loop", "Set", "union", true, tSet_union_own_loop]);
function tSet_union_own_watched(x: Set<string>, k: any): any { try { const r = x.union(alterOwn(x, "union", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_union_own_watched", "Set", "union", true, tSet_union_own_watched]);
function tSet_union_prototype_plain(x: Set<string>, k: any): any { const r = x.union(alterPrototype(x, "union", other)); return [r]; }
table.push(["tSet_union_prototype_plain", "Set", "union", true, tSet_union_prototype_plain]);
function tSet_union_prototype_tail(x: Set<string>, k: any): any { return x.union(alterPrototype(x, "union", other)); }
table.push(["tSet_union_prototype_tail", "Set", "union", true, tSet_union_prototype_tail]);
function tSet_union_prototype_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(alterPrototype(x, "union", other)); return [r]; }
table.push(["tSet_union_prototype_loop", "Set", "union", true, tSet_union_prototype_loop]);
function tSet_union_prototype_watched(x: Set<string>, k: any): any { try { const r = x.union(alterPrototype(x, "union", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_union_prototype_watched", "Set", "union", true, tSet_union_prototype_watched]);
function tSet_union_round_plain(x: Set<string>, k: any): any { const r = x.union(addAndDelete(x, other)); return [r]; }
table.push(["tSet_union_round_plain", "Set", "union", true, tSet_union_round_plain]);
function tSet_union_round_tail(x: Set<string>, k: any): any { return x.union(addAndDelete(x, other)); }
table.push(["tSet_union_round_tail", "Set", "union", true, tSet_union_round_tail]);
function tSet_union_round_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(addAndDelete(x, other)); return [r]; }
table.push(["tSet_union_round_loop", "Set", "union", true, tSet_union_round_loop]);
function tSet_union_round_watched(x: Set<string>, k: any): any { try { const r = x.union(addAndDelete(x, other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_union_round_watched", "Set", "union", true, tSet_union_round_watched]);
function tSet_union_conditional_plain(x: Set<string>, k: any): any { const r = x.union((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["tSet_union_conditional_plain", "Set", "union", true, tSet_union_conditional_plain]);
function tSet_union_conditional_tail(x: Set<string>, k: any): any { return x.union((k ? note("yes", other) : note("no", undefined))); }
table.push(["tSet_union_conditional_tail", "Set", "union", true, tSet_union_conditional_tail]);
function tSet_union_conditional_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["tSet_union_conditional_loop", "Set", "union", true, tSet_union_conditional_loop]);
function tSet_union_conditional_watched(x: Set<string>, k: any): any { try { const r = x.union((k ? note("yes", other) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_union_conditional_watched", "Set", "union", true, tSet_union_conditional_watched]);
function tSet_union_throws_plain(x: Set<string>, k: any): any { const r = x.union(fail(other)); return [r]; }
table.push(["tSet_union_throws_plain", "Set", "union", true, tSet_union_throws_plain]);
function tSet_union_throws_tail(x: Set<string>, k: any): any { return x.union(fail(other)); }
table.push(["tSet_union_throws_tail", "Set", "union", true, tSet_union_throws_tail]);
function tSet_union_throws_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.union(fail(other)); return [r]; }
table.push(["tSet_union_throws_loop", "Set", "union", true, tSet_union_throws_loop]);
function tSet_union_throws_watched(x: Set<string>, k: any): any { try { const r = x.union(fail(other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_union_throws_watched", "Set", "union", true, tSet_union_throws_watched]);
function tSet_isSubsetOf_call_plain(x: Set<string>, k: any): any { const r = x.isSubsetOf(note("argument", other)); return [r]; }
table.push(["tSet_isSubsetOf_call_plain", "Set", "isSubsetOf", true, tSet_isSubsetOf_call_plain]);
function tSet_isSubsetOf_call_tail(x: Set<string>, k: any): any { return x.isSubsetOf(note("argument", other)); }
table.push(["tSet_isSubsetOf_call_tail", "Set", "isSubsetOf", true, tSet_isSubsetOf_call_tail]);
function tSet_isSubsetOf_call_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(note("argument", other)); return [r]; }
table.push(["tSet_isSubsetOf_call_loop", "Set", "isSubsetOf", true, tSet_isSubsetOf_call_loop]);
function tSet_isSubsetOf_call_watched(x: Set<string>, k: any): any { try { const r = x.isSubsetOf(note("argument", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_isSubsetOf_call_watched", "Set", "isSubsetOf", true, tSet_isSubsetOf_call_watched]);
function tSet_isSubsetOf_getter_plain(x: Set<string>, k: any): any { const r = x.isSubsetOf(holder(other).value); return [r]; }
table.push(["tSet_isSubsetOf_getter_plain", "Set", "isSubsetOf", true, tSet_isSubsetOf_getter_plain]);
function tSet_isSubsetOf_getter_tail(x: Set<string>, k: any): any { return x.isSubsetOf(holder(other).value); }
table.push(["tSet_isSubsetOf_getter_tail", "Set", "isSubsetOf", true, tSet_isSubsetOf_getter_tail]);
function tSet_isSubsetOf_getter_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(holder(other).value); return [r]; }
table.push(["tSet_isSubsetOf_getter_loop", "Set", "isSubsetOf", true, tSet_isSubsetOf_getter_loop]);
function tSet_isSubsetOf_getter_watched(x: Set<string>, k: any): any { try { const r = x.isSubsetOf(holder(other).value); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_isSubsetOf_getter_watched", "Set", "isSubsetOf", true, tSet_isSubsetOf_getter_watched]);
function tSet_isSubsetOf_own_plain(x: Set<string>, k: any): any { const r = x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); return [r]; }
table.push(["tSet_isSubsetOf_own_plain", "Set", "isSubsetOf", true, tSet_isSubsetOf_own_plain]);
function tSet_isSubsetOf_own_tail(x: Set<string>, k: any): any { return x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); }
table.push(["tSet_isSubsetOf_own_tail", "Set", "isSubsetOf", true, tSet_isSubsetOf_own_tail]);
function tSet_isSubsetOf_own_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); return [r]; }
table.push(["tSet_isSubsetOf_own_loop", "Set", "isSubsetOf", true, tSet_isSubsetOf_own_loop]);
function tSet_isSubsetOf_own_watched(x: Set<string>, k: any): any { try { const r = x.isSubsetOf(alterOwn(x, "isSubsetOf", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_isSubsetOf_own_watched", "Set", "isSubsetOf", true, tSet_isSubsetOf_own_watched]);
function tSet_isSubsetOf_prototype_plain(x: Set<string>, k: any): any { const r = x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); return [r]; }
table.push(["tSet_isSubsetOf_prototype_plain", "Set", "isSubsetOf", true, tSet_isSubsetOf_prototype_plain]);
function tSet_isSubsetOf_prototype_tail(x: Set<string>, k: any): any { return x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); }
table.push(["tSet_isSubsetOf_prototype_tail", "Set", "isSubsetOf", true, tSet_isSubsetOf_prototype_tail]);
function tSet_isSubsetOf_prototype_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); return [r]; }
table.push(["tSet_isSubsetOf_prototype_loop", "Set", "isSubsetOf", true, tSet_isSubsetOf_prototype_loop]);
function tSet_isSubsetOf_prototype_watched(x: Set<string>, k: any): any { try { const r = x.isSubsetOf(alterPrototype(x, "isSubsetOf", other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_isSubsetOf_prototype_watched", "Set", "isSubsetOf", true, tSet_isSubsetOf_prototype_watched]);
function tSet_isSubsetOf_round_plain(x: Set<string>, k: any): any { const r = x.isSubsetOf(addAndDelete(x, other)); return [r]; }
table.push(["tSet_isSubsetOf_round_plain", "Set", "isSubsetOf", true, tSet_isSubsetOf_round_plain]);
function tSet_isSubsetOf_round_tail(x: Set<string>, k: any): any { return x.isSubsetOf(addAndDelete(x, other)); }
table.push(["tSet_isSubsetOf_round_tail", "Set", "isSubsetOf", true, tSet_isSubsetOf_round_tail]);
function tSet_isSubsetOf_round_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(addAndDelete(x, other)); return [r]; }
table.push(["tSet_isSubsetOf_round_loop", "Set", "isSubsetOf", true, tSet_isSubsetOf_round_loop]);
function tSet_isSubsetOf_round_watched(x: Set<string>, k: any): any { try { const r = x.isSubsetOf(addAndDelete(x, other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_isSubsetOf_round_watched", "Set", "isSubsetOf", true, tSet_isSubsetOf_round_watched]);
function tSet_isSubsetOf_conditional_plain(x: Set<string>, k: any): any { const r = x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["tSet_isSubsetOf_conditional_plain", "Set", "isSubsetOf", true, tSet_isSubsetOf_conditional_plain]);
function tSet_isSubsetOf_conditional_tail(x: Set<string>, k: any): any { return x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); }
table.push(["tSet_isSubsetOf_conditional_tail", "Set", "isSubsetOf", true, tSet_isSubsetOf_conditional_tail]);
function tSet_isSubsetOf_conditional_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); return [r]; }
table.push(["tSet_isSubsetOf_conditional_loop", "Set", "isSubsetOf", true, tSet_isSubsetOf_conditional_loop]);
function tSet_isSubsetOf_conditional_watched(x: Set<string>, k: any): any { try { const r = x.isSubsetOf((k ? note("yes", other) : note("no", undefined))); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_isSubsetOf_conditional_watched", "Set", "isSubsetOf", true, tSet_isSubsetOf_conditional_watched]);
function tSet_isSubsetOf_throws_plain(x: Set<string>, k: any): any { const r = x.isSubsetOf(fail(other)); return [r]; }
table.push(["tSet_isSubsetOf_throws_plain", "Set", "isSubsetOf", true, tSet_isSubsetOf_throws_plain]);
function tSet_isSubsetOf_throws_tail(x: Set<string>, k: any): any { return x.isSubsetOf(fail(other)); }
table.push(["tSet_isSubsetOf_throws_tail", "Set", "isSubsetOf", true, tSet_isSubsetOf_throws_tail]);
function tSet_isSubsetOf_throws_loop(x: Set<string>, k: any): any { let r: any; for (let i = 0; i < 2; i++) r = x.isSubsetOf(fail(other)); return [r]; }
table.push(["tSet_isSubsetOf_throws_loop", "Set", "isSubsetOf", true, tSet_isSubsetOf_throws_loop]);
function tSet_isSubsetOf_throws_watched(x: Set<string>, k: any): any { try { const r = x.isSubsetOf(fail(other)); return [r]; } catch (e) { return thrown(e); } }
table.push(["tSet_isSubsetOf_throws_watched", "Set", "isSubsetOf", true, tSet_isSubsetOf_throws_watched]);

const lines: string[] = [];
for (const [label, c, m, typed, f] of table) {
    for (const [which, make] of receiversOf(c, m, typed)) {
        notes.length = 0;
        const x = make();
        let said: string;
        try { said = show(f(x, 1)); } catch (e) { said = "THROWS " + thrown(e); }
        lines.push(label + " | " + which + " | " + said + " | " + notes.join(", ") + " | " + show(x));
    }
}
await Promise.resolve();
console.log(lines.join("\n"));

