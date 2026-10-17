interface Row { id: number; name: string; next: Row | null }
interface Wide extends Row { extra: string }
class Counter { count = 1; bump(): number { return ++this.count; } }

function say(label: string, make: () => unknown): void {
  try { console.log(label, String(make())); } catch (error) { console.log(label, "THROWS", (error as Error).constructor.name); }
}
function total(row: Row): string { return row.id + "|" + row.name; }
function walk(row: Row): number { let n = 0; for (let r: Row | null = row; r; r = r.next) n++; return n; }
function twice(n: number): unknown { return n + n; }
function shout(s: string): unknown { return s + "!"; }

const made: Row = { id: 1, name: "made", next: null };
const fits = JSON.parse('{"id":2,"name":"fits","next":{"id":3,"name":"inner","next":null}}') as Row;
const lies = JSON.parse('{"id":"x","name":5,"next":7}') as Row;
const lacks = JSON.parse('{"id":4}') as Row;
const proxied = new Proxy(made, {}) as Row;
const inherits = Object.create(made) as Row;

say("made", () => total(made) + walk(made));
say("fits", () => total(fits) + walk(fits));
say("lacks", () => total(lacks));
say("lacks, its string", () => shout(lacks.name));
say("a Proxy", () => total(proxied) + walk(proxied));
say("an heir", () => total(inherits) + walk(inherits));

say("a number as a string", () => shout(5 as unknown as string));
say("undefined as a number", () => twice(undefined as unknown as number));
const nothing: unknown = null;
say("null as a Row, tested", () => ((nothing as Row) ? "some" : "none"));
say("a string as an object", () => Object.keys("hey" as unknown as object).join(","));
say("a number as a Row, read", () => (7 as unknown as Row).id);

const names: string[] = ["a"];
say("a missing element!", () => typeof names[3]!);
say("a missing element! used", () => shout(names[3]!));
const maybe: { held?: Row } = {};
say("a missing property!", () => typeof maybe.held!);
let later: Row | undefined;
say("an unset variable!", () => typeof later!);
say("a missing Map entry!", () => typeof new Map<string, Row>().get("k")!);
function first(rows: Row[]): Row { return rows[0]!; }
say("undefined returned as a Row", () => typeof first([]));

say("a Row as a Wide", () => typeof (made as Wide).extra);
say("a Row as a Wide, stored to", () => { const wide = { id: 9, name: "w", next: null } as Row as Wide; wide.extra = "e"; return wide.extra + Object.keys(wide).join(","); });
say("a plain object as a Counter", () => ({ count: 5 } as unknown as Counter).count);
say("a plain object as a Counter, called", () => ({ count: 5 } as unknown as Counter).bump());
say("an empty literal as a Row", () => { const row = {} as Row; row.id = 6; return row.id + String(row.name); });

const kept: Row[] = [];
kept.push(lies);
const held = new Map<string, Row>([["k", lies]]);
const holder: { row: Row } = { row: made };
holder.row = lies;
say("the same object", () => lies === (lies as unknown as Row) && fits === kept.concat(fits)[1]);
say("its keys", () => Object.keys(fits).join(",") + JSON.stringify(lies));
