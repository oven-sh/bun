// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) in typed code, where the result of the inner call has an object type: generic helpers, annotated and inferred results, typed literals and class instances as source and target, and the errors of either call.
const lines: string[] = [];
function show(label: string, run: () => unknown): void { try { lines.push(label + ": " + String(run())); } catch (error) { lines.push(label + ": " + (error as Error).constructor.name); } }
function whole(object: object): string { return Reflect.ownKeys(object).map(key => { const d = Object.getOwnPropertyDescriptor(object, key)!; return String(key) + ("value" in d ? "=" + (typeof d.value === "function" ? "function" : String(d.value)) : "(" + (d.get ? "get" : "") + (d.set ? "set" : "") + ")") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" "); }
function merge<T extends object, U extends object>(target: T, source: U): T & U { return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) as T & U; }
function mergeOntoCopy<T extends object, U extends object>(base: T, extra: U): T & U { return Object.defineProperties({ ...base }, Object.getOwnPropertyDescriptors(extra)) as T & U; }
function mergeAnnotated(target: { a: number }, source: { b: string }): { a: number } { const merged: { a: number } = Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); return merged; }
function mergeKept(target: object, source: { b: string }): string { const descriptors = Object.getOwnPropertyDescriptors(source); const merged = Object.defineProperties(target, descriptors); return whole(merged) + " | " + Object.keys(descriptors).join(); }
function mergeNullable(target: object, source: object | undefined): object { return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source as object)); }
interface Tool { name: string; level: number; readonly label: string }
class Point { x = 1; y = 2; get sum(): number { return this.x + this.y; } }
const defaults = { enabled: true, level: 1, describe(): string { return "default"; } };
show("plain onto plain", () => whole(merge({ a: 1 }, { b: "two", c: 3 })));
show("a getter is kept", () => { let ran = 0; const made = merge({ a: 1 }, { get late(): number { ran++; return 7; } }); const before = ran; return whole(made) + " " + before + " " + made.late + " " + ran; });
show("onto a copy", () => { const tool = mergeOntoCopy(defaults, { name: "first", level: 2, get label(): string { return this.name + ":" + this.level; } }); const typed: Tool = tool; return whole(tool) + " " + typed.label + " " + tool.describe() + " " + defaults.level; });
show("annotated", () => whole(mergeAnnotated({ a: 1 }, { b: "two" })));
show("the descriptors are kept", () => mergeKept({ a: 1 }, { b: "two" }));
show("an instance as source", () => whole(merge({ z: 0 }, new Point())));
show("an instance as target", () => { const point = merge(new Point(), { z: 3, get double(): number { return 6; } }); return whole(point) + " " + point.sum + " " + point.double; });
show("a typed literal as target", () => { const target: { a: number; b?: string } = { a: 1 }; const made = merge(target, { b: "two" }); return whole(made) + " " + target.b; });
show("replaces what is there", () => whole(merge({ a: 1, b: 2 }, { a: "new", get b(): string { return "got"; } })));
show("symbols last", () => { const key = Symbol("key"); return whole(merge({}, { [key]: 1, a: 2 })); });
show("a frozen source", () => whole(merge({}, Object.freeze({ a: 1, b: 2 }))));
show("a frozen target", () => whole(merge(Object.freeze({ a: 1 }), { b: 2 })));
show("an array as source", () => whole(mergeNullable({}, [1, 2])));
show("undefined as source", () => whole(mergeNullable({}, undefined)));
show("many", () => { let sum = 0; for (let i = 0; i < 2000; i++) { const made = mergeOntoCopy(defaults, { name: "n", level: i, get twice(): number { return this.level * 2; } }); sum += made.level + made.twice + Object.keys(made).length; } return sum; });
console.log(lines.join("\n"));
