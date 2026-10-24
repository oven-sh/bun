import type { int32 } from "bun";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function markOf(v: int32): true | undefined {
  return v["bun.int32"];
}
function marked(v: int32): string {
  return v["bun.int32"] ? "marked" : "plain";
}
function hasMark(v: int32): boolean {
  return v["bun.int32"] === true;
}
const holder: { at: int32 } = { at: 4 };

attempt("of a constant", () => [markOf(1), marked(1), hasMark(1)]);
attempt("of a member", () => [markOf(holder.at), marked(holder.at), hasMark(holder.at), holder.at["bun.int32"]]);
attempt("of a sum", () => markOf((holder.at + 1) | 0));
attempt("with a default", () => holder.at["bun.int32"] ?? "nothing");
attempt("the other members of a number", () => [holder.at.toFixed(1), holder.at.toString(2), holder.at.valueOf(), typeof holder.at]);
