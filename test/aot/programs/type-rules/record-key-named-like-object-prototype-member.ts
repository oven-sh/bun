// `table["toString"]` on a type that has a string index signature and nothing else has the type of that signature; `table.toString` has the type of Object.prototype's method.
// A dictionary may hold a value under any key, also under the names that Object.prototype has.
interface Entry { result: string }
function attempt(label: string, run: () => unknown): void {
  try { console.log(label + ": " + JSON.stringify(run())); } catch (error) { console.log(label + ": threw " + (error as Error).name); }
}
const cast = { toString: { result: "first" }, plain: { result: "second" } } as Record<string, Entry>;
const made: Record<string, Entry> = {};
made["toString"] = { result: "stored" }; made["valueOf"] = { result: "v" }; made["constructor"] = { result: "c" }; made["hasOwnProperty"] = { result: "h" };
const indexed: { [key: string]: Entry } = {};
indexed["toString"] = { result: "i" };
const parsed: Record<string, Entry> = JSON.parse('{"toString":{"result":"p"},"constructor":{"result":"pc"}}');
const numbers: Record<string, number> = {};
numbers["toString"] = 5; numbers["valueOf"] = 6;
const texts: Record<string, string> = { isPrototypeOf: "text" };
const key: string = "toString";
function read(table: Record<string, Entry>): string { return table["toString"].result; }
function readBy(table: Record<string, Entry>, name: string): string { return table[name].result; }
function sum(): number { return numbers["toString"] + 1; }
function whole(): number { return numbers["toString"]; }

console.log(cast["plain"].result, cast["toString"].result, made["toString"].result, numbers["toString"] + numbers["valueOf"], texts["isPrototypeOf"].length);
attempt("a cast literal", () => cast["toString"].result);
attempt("by a variable", () => cast[key].result);
attempt("stored", () => [made["toString"].result, made["valueOf"].result, made["constructor"].result, made["hasOwnProperty"].result]);
attempt("an index signature", () => indexed["toString"].result);
attempt("parsed", () => parsed["toString"].result + parsed["constructor"].result);
attempt("a parameter", () => read(made) + read(cast) + read(parsed));
attempt("a parameter, by name", () => readBy(made, "toString") + readBy(cast, "toString"));
attempt("numbers", () => [numbers["toString"] + numbers["valueOf"], sum(), whole(), numbers["toString"] * 2, -numbers["valueOf"]]);
attempt("texts", () => [texts["isPrototypeOf"] + "!", texts["isPrototypeOf"].toUpperCase()]);
attempt("the value itself", () => made["toString"]);
attempt("nothing stored", () => typeof ({} as Record<string, Entry>)["toString"]);
attempt("optional chain", () => made["toString"]?.result);
attempt("keys", () => Object.keys(made).join());
attempt("in", () => "toString" in made);
attempt("stored again", () => { made["toString"] = { result: "again" }; return made["toString"].result; });
attempt("compound", () => { numbers["toString"] += 2; numbers["valueOf"]++; return [numbers["toString"], numbers["valueOf"]]; });
