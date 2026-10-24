// `a + b` where TypeScript says both are strings and both are missing at run time is NaN, or 0 for two nulls, as in plain Bun: it does not throw.
const none: string[] = [];
const some: string[] = ["a", "b"];
function show(name: string, f: () => unknown) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", (e as Error).constructor.name); } }

function inOneExpression(list: string[], i: number) { return list[i] + list[i + 1]; }
function constants(list: string[], i: number) { const a = list[i], b = list[i + 1]; return a + b; }
function parameters(a: string, b: string) { return a + b; }
function passed(list: string[], i: number) { return parameters(list[i], list[i + 1]); }
function fields(list: string[], i: number) { const o = { a: list[i], b: list[i + 1] }; return o.a + o.b; }
function dictionary(map: Record<string, string>) { return map.a + map.b; }
function pattern(list: string[]) { const [a, b] = list; return a + b; }
function popped(list: string[]) { return list.pop()! + list.pop()!; }
function nulls(a: string, b: string) { return a + b; }
function three(list: string[], i: number) { return list[i] + list[i + 1] + list[i + 2]; }
function thenText(list: string[], i: number) { return list[i] + list[i + 1] + "!"; }
function textFirst(list: string[], i: number) { return "!" + list[i] + list[i + 1]; }
function withNumber(list: string[], i: number) { const a = list[i]; return a + 1; }
class Pair { constructor(public first: string, public second: string) {} joined() { return this.first + this.second; } }

for (const list of [none, some]) {
  show("in one expression", () => inOneExpression(list, 0));
  show("constants", () => constants(list, 0));
  show("parameters", () => passed(list, 0));
  show("fields", () => fields(list, 0));
  show("pattern", () => pattern(list));
  show("three", () => three(list, 0));
  show("then text", () => thenText(list, 0));
  show("text first", () => textFirst(list, 0));
  show("with a number", () => withNumber(list, 0));
  show("members of a class", () => new Pair(list[0], list[1]).joined());
}
show("dictionary", () => dictionary({}));
show("dictionary", () => dictionary({ a: "a", b: "b" }));
show("popped", () => popped([]));
show("popped", () => popped(["a", "b"]));
show("nulls", () => nulls(null as unknown as string, null as unknown as string));
show("null and undefined", () => nulls(null as unknown as string, undefined as unknown as string));
