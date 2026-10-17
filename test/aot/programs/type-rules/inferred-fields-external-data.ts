// A class field or object-literal property whose type is only inferred may be assigned external data that does not match the inferred type.
// The assignment and later uses must behave as in plain JavaScript instead of asserting the inferred type.
const data = JSON.parse('{"t":"abc","u":"d"}') as { t: number; u: number };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + (typeof v === "object" ? JSON.stringify(v) : String(v)); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
class Initialized { v = data.t; }
class AssignedInConstructor { v = 0; constructor() { this.v = data.t; } }
class AssignedLater { v = 0; }
class AssignedInMethod { v = 0; load() { this.v = data.t; return this; } }
class Compound { v = 0; add() { this.v += data.t; return this; } }
class Static { static v = data.t; static w = 0; }
class Base { v = 0; }
class Derived extends Base { load() { this.v = data.t; return this; } }
class ParameterProperty { constructor(public v = data.t) {} }
class Trusted { v = 0; bump() { this.v += 1; return this; } }
class Written { v: number = 0; }
say("field initializer", () => new Initialized().v + 1);
say("field assigned in the constructor", () => new AssignedInConstructor().v + 1);
say("field assigned from outside", () => { const c = new AssignedLater(); c.v = data.t; return c.v + 1; });
say("field assigned in a method", () => new AssignedInMethod().load().v + 1);
say("field, compound assignment", () => new Compound().add().v + 1);
say("static field initializer", () => Static.v + 1);
say("static field assigned", () => { Static.w = data.t; return Static.w + 1; });
say("inherited field assigned in a subclass", () => new Derived().load().v + 1);
say("inherited field read through the base class", () => { const b: Base = new Derived().load(); return b.v + 1; });
say("parameter property default", () => new ParameterProperty().v + 1);
say("literal property assigned", () => { const o = { v: 0 }; o.v = data.t; return o.v + 1; });
say("literal property, compound assignment", () => { const o = { v: 0 }; o.v += data.t; return o.v + 1; });
say("literal property assigned in a helper", () => { const o = { v: 0 }; const set = (x: typeof o) => { x.v = data.t; }; set(o); return o.v + 1; });
say("nested literal property assigned", () => { const o = { inner: { v: 0 } }; o.inner.v = data.t; return o.inner.v + 1; });
say("literal returned by a function", () => { const make = () => ({ v: 0 }); const o = make(); o.v = data.t; return o.v + 1; });
say("literals in an array", () => { const l = [{ v: 0 }]; l[0].v = data.t; return l[0].v + 1; });
say("string property", () => { const o = { s: "" }; o.s = data.t as unknown as string; return o.s + 1; });
say("JSON of the object", () => { const o = { v: 0, w: 1 }; o.v = data.t; return o; });
say("keys stay in order", () => { const o = { a: 0, v: 0, z: 0 }; o.v = data.t; return Object.keys(o).join(); });
say("trusted field stays exact", () => new Trusted().bump().v + 1);
say("trusted literal stays exact", () => { const o = { v: 0 }; o.v = 2; return o.v + 1; });
