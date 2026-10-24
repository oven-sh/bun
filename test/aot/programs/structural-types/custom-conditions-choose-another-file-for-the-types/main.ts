import { describe, level, Logger } from "#env";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

attempt("a constant", () => [level, typeof level, level + 1, plusOne(level)]);
attempt("a result", () => [describe(), typeof describe(), describe() + "!"]);
attempt("the size of a result", () => size(describe()));
attempt("a class", () => {
  const logger = new Logger();
  const result = logger.write("line");
  return [result, typeof result, result + 1, plusOne(result), Object.keys(logger).join()];
});
attempt("a field that only one of them has", () => new Logger().lines.length);
