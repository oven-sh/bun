// `let x!: T` and a field `x!: T` test nothing: until something is stored, a read gives undefined, whatever T is.
interface Row { id: number; name: string }

function say(label: string, make: () => unknown): void {
  try { console.log(label, String(make())); } catch (error) { console.log(label, "THROWS", (error as Error).constructor.name); }
}
function shout(text: string): string { return text + "!"; }
function twice(n: number): number { return n + n; }

let size!: number;
let title!: string;
let row!: Row;
let flag!: boolean;
let list!: number[];
let later!: string;
class Holder { held!: Row; count!: number; read(): number { return this.count + 1; } }
function local(): string { let text!: string; return typeof text; }
function captured(): () => string { let text!: string; return () => typeof text; }
function setThenRead(): number { let n!: number; n = 4; return n + 1; }

say("a number, its type", () => typeof size);
say("a number, added", () => size + 1);
say("a number, passed on", () => twice(size));
say("a string, passed on", () => shout(title));
say("a string, in a template", () => `${title}`);
say("an object, its type", () => typeof row);
say("an object, read", () => row.id);
say("an object, tested", () => (row ? "some" : "none"));
say("a boolean, tested", () => (flag ? "yes" : "no"));
say("an array, read", () => list.length);
say("compared", () => size === undefined);
say("a local", () => local());
say("a captured local", () => captured()());
say("set, then read", () => setThenRead());
say("a field, its type", () => typeof new Holder().held);
say("a field, added", () => new Holder().read());
say("a field, read", () => new Holder().held.name);
later = "now";
say("set at last", () => shout(later));
size = 3;
say("the number, set at last", () => twice(size));
let count!: number;
let total!: number;
function bump(): number { count++; return count; }
say("minus", () => 10 - total);
say("times", () => total * 2);
say("negated", () => -total);
say("remainder", () => total % 2);
say("or zero", () => total | 0);
say("in a template, added", () => `${total + 1}`);
say("incremented in place", () => bump());
say("copied, then incremented", () => { let n = total; n++; return n; });
say("switch", () => { switch (total) { case 5: return "five"; case 0: return "zero"; default: return "other"; } });
say("as an index", () => [1, 2][total]);
say("Math.max", () => Math.max(total, 1));
total = 5;
say("set: minus", () => 10 - total);
say("set: switch", () => { switch (total) { case 5: return "five"; case 0: return "zero"; default: return "other"; } });
