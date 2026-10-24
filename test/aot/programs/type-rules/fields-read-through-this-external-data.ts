// A field with an inferred type that holds external data is read inside its class, through `this`.
const data = JSON.parse('{"t":"abc"}') as { t: number };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
class Public { v = data.t; sum() { return this.v + 1; } read() { return this.v; } }
class Assigned { v = 0; load() { this.v = data.t; return this; } sum() { return this.v + 1; } }
class Trusted { v = 2; sum() { return this.v + 1; } }
say("a public field, used inside", () => new Public().sum());
say("a public field, returned", () => new Public().read() + 1);
say("a public field assigned in a method", () => new Assigned().load().sum());
say("trusted fields stay exact", () => new Trusted().sum());
