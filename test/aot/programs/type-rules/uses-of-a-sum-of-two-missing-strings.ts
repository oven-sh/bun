// What is done with a sum that TypeScript calls a string and that is NaN at run time does what it does in plain Bun, wherever no annotation says string.
const none: string[] = [];
const some: string[] = ["a", "b"];
function show(name: string, f: () => unknown) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", (e as Error).constructor.name); } }

function lengthOf(list: string[], i: number) { return (list[i] + list[i + 1]).length; }
function lengthOfEither(list: string[], i: number, c: boolean) { return (c ? list[i] + list[i + 1] : "x").length; }
function lengthOfConstant(list: string[], i: number) { const s = list[i] + list[i + 1]; return s.length; }
function lengthOfVariable(list: string[], i: number, c: boolean) { let s = "x"; if (c) s = list[i] + list[i + 1]; return s.length; }
function lengthAfterAppend(list: string[], i: number) { let s = list[i]; s += list[i + 1]; return s.length; }
function lengthOrElse(list: string[], i: number) { return (list[i] + list[i + 1] || "x").length; }
function appendedInLoop(list: string[]) { let s = list[0]; for (let i = 1; i < 3; i++) s += list[i]; return s; }
function accumulated(list: string[]) { let s = ""; for (let i = 0; i < 3; i++) s += list[i]; return s; }
function typeOf(list: string[], i: number) { const s = list[i] + list[i + 1]; return typeof s; }
function compared(list: string[], i: number) { const s = list[i] + list[i + 1]; return s === s; }
function inTemplate(list: string[], i: number) { return `<${list[i] + list[i + 1]}>`; }
function asKey(list: string[], i: number) { const seen: Record<string, number> = {}; seen[list[i] + list[i + 1]] = 1; return Object.keys(seen).join(); }
function returnedTwice(list: string[], i: number) { const inner = () => list[i] + list[i + 1]; return inner(); }
function calledOn(list: string[], i: number) { return (list[i] + list[i + 1]).toString(); }
function throwsInBoth(list: string[], i: number) { return (list[i] + list[i + 1]).toUpperCase(); }

for (const list of [none, some]) {
  show("length", () => lengthOf(list, 0));
  show("length of either", () => lengthOfEither(list, 0, true));
  show("length of a constant", () => lengthOfConstant(list, 0));
  show("length of a variable", () => lengthOfVariable(list, 0, true));
  show("length after an append", () => lengthAfterAppend(list, 0));
  show("length or else", () => lengthOrElse(list, 0));
  show("appended in a loop", () => appendedInLoop(list));
  show("accumulated", () => accumulated(list));
  show("typeof", () => typeOf(list, 0));
  show("compared", () => compared(list, 0));
  show("in a template", () => inTemplate(list, 0));
  show("as a key", () => asKey(list, 0));
  show("returned twice", () => returnedTwice(list, 0));
  show("called on", () => calledOn(list, 0));
  show("throws in both", () => throwsInBoth(list, 0));
}
