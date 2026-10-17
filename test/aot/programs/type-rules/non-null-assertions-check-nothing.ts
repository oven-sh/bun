interface Row { id: number; name: string; next: Row | null }

function say(label: string, make: () => unknown): void {
  try { console.log(label, String(make())); } catch (error) { console.log(label, "THROWS", (error as Error).constructor.name); }
}
function shout(text: string): string { return text + "!"; }
function twice(n: number): number { return n + n; }
function first(rows: Row[]): Row { return rows[0]!; }
function nameOf(row: Row | null): string { return row!.name; }
function keep(row: Row | undefined): Row { const kept: Row = row!; return kept; }

const names: string[] = ["a", "b"];
const counts: number[] = [1, 2];
const rows: Row[] = [{ id: 1, name: "one", next: null }];
const byName = new Map<string, Row>([["one", rows[0]!]]);
const maybe: { held?: string; row?: Row } = {};
let later: string | undefined;
let nothing: Row | null = null;
class Holder { row: Row | null = null; take(): Row { return this.row!; } }

say("an element that is there", () => shout(names[1]!));
say("a missing element", () => typeof names[3]!);
say("a missing element, passed on", () => shout(names[3]!));
say("a missing number, added", () => twice(counts[5]!));
say("a missing property", () => typeof maybe.held!);
say("a missing property, passed on", () => shout(maybe.held!));
say("an unset variable", () => typeof later!);
say("a Map entry that is there", () => byName.get("one")!.name);
say("a missing Map entry", () => typeof byName.get("two")!);
say("a missing Map entry, read", () => byName.get("two")!.name);
say("a missing result", () => typeof first([]));
say("a missing result, read", () => first([]).id);
say("null, read", () => nameOf(null));
say("null, tested afterwards", () => (nothing! ? "some" : "none"));
say("undefined into an annotated variable", () => typeof keep(undefined));
say("undefined into an annotated variable, read", () => keep(undefined).id);
say("null out of a field", () => String(new Holder().take()));
say("null out of a field, read", () => new Holder().take().name);
say("twice", () => typeof maybe.row!.next!);
say("in a template", () => `${names[9]!}`);
say("compared", () => names[9]! === undefined);
say("stored and read back", () => { const list: string[] = []; list.push(names[9]!); return list.length + String(list[0]); });
say("after it, the value is still there", () => { const row = rows[0]!; return row.id + row.name; });
