// Objects of a union whose tags are texts, written as constant literals: the tag is told from the other tags, until somebody stores another text, another kind of value, or deletes it, behind the checker's back.
const lines: string[] = [];
function say(label: string, value: unknown): void {
  lines.push(label + ": " + String(value));
}
type Shape = { kind: "circle"; r: number } | { kind: "square"; w: number } | { kind: "dot" };
const shapes: Shape[] = [{ kind: "circle", r: 2 }, { kind: "square", w: 3 }, { kind: "dot" }];
function area(s: Shape): number {
  if (s.kind === "circle") return s.r * s.r * 3;
  if (s.kind === "square") return s.w * s.w;
  return 0;
}
function name(s: Shape): string {
  switch (s.kind) {
    case "circle":
      return "c" + s.r;
    case "square":
      return "s" + s.w;
    case "dot":
      return "d";
    default:
      return "other " + typeof (s as { kind: unknown }).kind + " " + String((s as { kind: unknown }).kind);
  }
}
function all(): string {
  let text = "";
  for (const s of shapes) text += area(s) + name(s) + s.kind.length + ";";
  return text;
}
const nested = { outer: { kind: "circle", r: 1 } as Shape, label: "fixed", list: ["circle", "square", "kind"] };
function inner(): string {
  return name(nested.outer) + nested.label + nested.list.join() + nested.list.includes(nested.outer.kind) + (nested.label === "fixed");
}
const table = { circle: "round", square: "flat", dot: "small" } as const;
function look(s: Shape): string {
  return table[s.kind] + (table.circle === "round") + Object.values(table).join();
}
function attempt(f: () => unknown): string {
  try {
    return String(f());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
let last = "";
for (let turn = 0; turn < 60; turn++) last = all() + inner() + look(shapes[turn % 3]!);
say("before", last);
(shapes[0] as { kind: string }).kind = "square";
say("another tag of the union", attempt(all));
(shapes[1] as { kind: string }).kind = "hexagon";
say("a text that is no tag", attempt(all));
(shapes[2] as unknown as { kind: number }).kind = 7;
say("a number", attempt(all));
delete (shapes[0] as { kind?: string }).kind;
say("deleted", attempt(all));
Object.defineProperty(shapes[1], "kind", { get: () => "circle", configurable: true });
say("a getter", attempt(all));
(nested.outer as { kind: string }).kind = ["d", "ot"].join("");
say("a text made at run time", attempt(inner));
(nested as { label: string }).label = "fix" + "ed".slice(0);
say("the same text made anew", attempt(inner));
Object.assign(nested, { label: 5 });
say("assigned by a built-in", attempt(inner));
(table as unknown as Record<string, string>)["circle"] = "square";
say("the table", attempt(() => look({ kind: "circle", r: 1 })));
shapes.push(JSON.parse('{"kind":"circle","r":5}') as Shape, { kind: "square", w: lines.length });
say("parsed and made", attempt(all));
console.log(lines.join("\n"));
