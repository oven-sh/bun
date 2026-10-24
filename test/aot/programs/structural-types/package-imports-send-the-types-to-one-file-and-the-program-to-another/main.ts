import { host, port, retries, timeout } from "#config";
import { name as first } from "#many/first";
import { name as second } from "#many/second";
import { built, Square } from "#shapes";
import { plusOne } from "#typed";

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

attempt("a number", () => [port, typeof port, port + 1, plusOne(port)]);
attempt("a text", () => [host, typeof host, host + "!"]);
attempt("the length of a text", () => host.length);
attempt("a list", () => [retries.length, retries[0], typeof retries]);
attempt("a list, mapped", () => retries.map(plusOne));
attempt("a result", () => [typeof timeout(), timeout() + 1, plusOne(timeout()), timeout() * 2]);
attempt("which build", () => [built, built === "default"]);
attempt("a class", () => {
  const s = new Square(3);
  return [s.side, typeof s.side, s.side + 1, s.area(), Object.keys(s).join()];
});
attempt("typed sources", () => [plusOne(1), first, second]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + new Square(i).area();
console.log("2000 rounds: " + warm);
