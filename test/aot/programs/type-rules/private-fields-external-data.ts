// A private field with an inferred type that holds external data of another type: reading it must behave as in plain JavaScript.
const data = JSON.parse('{"t":"abc"}') as { t: number };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
class Private { #v = data.t; sum() { return this.#v + 1; } read() { return this.#v; } }
class PrivateAssigned { #v = 0; load() { this.#v = data.t; return this; } sum() { return this.#v + 1; } }
class List { #all = [1]; add() { this.#all.push(data.t); return this; } last() { return this.#all[1] + 1; } }
say("a private field, used inside", () => new Private().sum());
say("a private field, returned", () => new Private().read() + 1);
say("a private field assigned in a method", () => new PrivateAssigned().load().sum());
say("a static private field", () => { class PrivateStatic { static #v = data.t; static sum() { return PrivateStatic.#v + 1; } } return PrivateStatic.sum(); });
say("a private array", () => new List().add().last());
