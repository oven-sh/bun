// A getter without a written return type that returns external data of another type: reading the property must behave as in plain JavaScript.
const data = JSON.parse('{"t":"abc"}') as { t: number };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
const holder = { get accessor() { return data.t; }, get trusted() { return 1; } };
class Holder { get accessor() { return data.t; } static get fixed() { return data.t; } get through() { const v = data.t; return v; } get trusted() { return 1; } }
class Derived extends Holder {}
say("a getter of a literal", () => holder.accessor + 1);
say("a getter of a class", () => new Holder().accessor + 1);
say("a static getter", () => Holder.fixed + 1);
say("a getter that goes through a variable", () => new Holder().through + 1);
say("an inherited getter", () => new Derived().accessor + 1);
say("into a variable", () => { let n = 0; n = holder.accessor; return n + 1; });
say("added to a variable", () => { let n = 0; n += new Holder().accessor; return n; });
say("into an array", () => { const c = [holder.accessor]; return c[0] + 1; });
say("trusted getters stay exact", () => holder.trusted + new Holder().trusted + 1);
