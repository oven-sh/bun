// An object made with `Object.create` from an object of an interface type is held to that type: it finds every field on its prototype chain, so it satisfies the type. It stays the object it is and is read by name. An own property of another kind that shadows a field throws where typed code reads the field.
interface Conf { host: string; port: number; secure?: boolean; nested: { depth: number } }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
function next(c: Conf): number { return c.port + 1 + c.nested.depth }
const defaults: Conf = { host: "localhost", port: 80, nested: { depth: 1 } }
rule("heir of an object of the type", () => { const derived: Conf = Object.create(defaults); return derived.port })
rule("then: typed code reads it", () => { const derived: Conf = Object.create(defaults); return next(derived) })
rule("then: a store makes an own property", () => { const derived: Conf = Object.create(defaults); derived.port = 81; return [derived.port, defaults.port, Object.keys(derived).join(), next(derived)] })
rule("then: the parent changes", () => { const derived: Conf = Object.create(defaults); defaults.port = 90; const seen = derived.port; defaults.port = 80; return seen })
rule("then: an ill-typed own property shadows", () => { const raw = Object.create(defaults); raw.port = "text"; const derived: Conf = raw; return [typeof derived.port, next(derived)] })
rule("heir of a frozen literal", () => { const locked: Conf = Object.create(Object.freeze({ host: "frozen", port: 1, nested: { depth: 2 } })); return next(locked) })
