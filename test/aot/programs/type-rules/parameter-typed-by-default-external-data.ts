// A parameter without an annotation takes its type from its default value. That type is inferred, so an argument that is external data of another type must behave as in plain JavaScript.
const data = JSON.parse('{"t":"abc","s":5}') as { t: number; s: string };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
const arrow = (p = 1) => p + 1;
function declared(p = 1, q = 2) { return p + q; }
const text = (p = "z") => p + p;
class Holder { method(p = 1) { return p * 2; } static fixed(p = 1) { return p + 1; } }
class Built { v; constructor(p = 1) { this.v = p; } }
class Kept { constructor(public v = 1) {} }
say("an arrow function", () => arrow(data.t));
say("called at once", () => ((p = 1) => p + 1)(data.t));
say("a declaration, the first parameter", () => declared(data.t));
say("a declaration, the second parameter", () => declared(1, data.t));
say("a string default", () => text(data.s));
say("a method", () => new Holder().method(data.t));
say("a static method", () => Holder.fixed(data.t));
say("a constructor parameter", () => new Built(data.t).v + 1);
say("a parameter property", () => new Kept(data.t).v + 1);
say("through a variable", () => { const v = data.t; return arrow(v); });
say("the default itself", () => arrow() + declared());
say("trusted arguments stay exact", () => arrow(2) + declared(3, 4) + new Holder().method(5));
