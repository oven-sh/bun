// Objects from untyped code are used as a union in which one member has a function and the other is plain data.
function row(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + String(f()));
  } catch (e) {
    console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e)));
  }
}
function hide(v: unknown): any {
  return v;
}
type Call = { t: "call"; run: () => string; at: { v: number } };
type Note = { t: "note"; text: string; at: { v: number } };
type Step = Call | Note;
function step(s: Step): string {
  s.at.v += 1;
  return s.t === "call" ? s.run() : s.text;
}
const madeCall: Step = { t: "call", run: () => "ran", at: { v: 0 } };
const madeNote: Step = { t: "note", text: "noted", at: { v: 0 } };
row("typed code only", () => step(madeCall) + step(madeNote));
row("union of a member with a function and a data member", () => {
  const a = hide(Object.assign({}, { t: "call", run: () => "r", at: { v: 1 } })); const b = hide(JSON.parse('{"t":"note","text":"n","at":{"v":1}}')); return step(a) + step(b) + step(a) + a.at.v + b.at.v;
});
