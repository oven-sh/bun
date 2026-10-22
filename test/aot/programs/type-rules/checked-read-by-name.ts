// Fields read by name from many shapes, and values of another kind that throw at the read.
declare const console: { log(...values: unknown[]): void };
interface Fields { n?: number; b?: boolean; s?: string; a?: number[] }
function show(value: unknown): string { return value === undefined ? "undefined" : JSON.stringify(value) }
function report(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
function readNumber(f: Fields): number | undefined { return f.n }
function readBoolean(f: Fields): boolean | undefined { return f.b }
function readString(f: Fields): string | undefined { return f.s }
function readArray(f: Fields): number[] | undefined { return f.a }
function readAll(f: Fields): string { return [show(readNumber(f)), show(readBoolean(f)), show(readString(f)), show(readArray(f))].join(" ") }
function outOfLine(): Fields { const o: any = {}; for (let i = 0; i < 40; i++) o["k" + i] = i; o.n = 1.5; o.b = false; o.s = "far"; o.a = [4]; return o }
class Base { n = 3; get b(): boolean { return true } get s(): string { return "got" } get a(): number[] { return [5, 6] } }
class Derived extends Base { extra = 1 }
class Numbers extends Array<number> {}
report("own inline", () => readAll({ n: 1, b: true, s: "x", a: [1, 2] }));
report("own inline double", () => readAll({ n: 0.5, b: false, s: "", a: [] }));
report("other key order", () => readAll({ a: [9], s: "y", b: true, n: -2 }));
report("out of line", () => readAll(outOfLine()));
report("inherited", () => readAll(Object.create({ n: 7, b: true, s: "proto", a: [8] })));
report("getters in a class", () => readAll(new Derived()));
report("getters in a literal", () => readAll({ get n() { return 2 }, get b() { return false }, get s() { return "lit" }, get a() { return [3] } }));
report("absent", () => readAll({}));
report("some absent", () => readAll({ n: 4 }));
report("null", () => readAll({ n: null, b: null, s: null, a: null } as any));
report("undefined", () => readAll({ n: undefined, b: undefined, s: undefined, a: undefined }));
report("array subclass", () => show(readArray({ a: Numbers.of(1, 2) })));
report("rope", () => readString({ s: "left-" + String(readNumber({ n: 1 })) }));
report("primitive receiver", () => readAll(5 as any));
report("null receiver", () => readAll(null as any));
report("number holds a string", () => readNumber({ n: "1" } as any));
report("number holds a boolean", () => readNumber({ n: true } as any));
report("number holds an object", () => readNumber({ n: {} } as any));
report("boolean holds a number", () => readBoolean({ b: 1 } as any));
report("boolean holds a string", () => readBoolean({ b: "true" } as any));
report("string holds a number", () => readString({ s: 7 } as any));
report("string holds an object", () => readString({ s: {} } as any));
report("array holds a string", () => readArray({ a: "abc" } as any));
report("array holds an object", () => readArray({ a: { length: 0 } } as any));
report("array holds a typed array", () => readArray({ a: new Uint8Array(1) } as any));
report("getter returns another kind", () => readNumber({ get n() { return "no" } } as any));
report("inherited holds another kind", () => readString(Object.create({ s: 1 })));
