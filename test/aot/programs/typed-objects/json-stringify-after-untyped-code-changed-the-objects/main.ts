// Untyped code changes objects that have a layout (adds, deletes, hides, freezes, gives them toJSON, other prototypes, cycles),
// and code that does not know their type writes them as JSON. Every change succeeds as in plain Bun, and what is written must be exact.
// ENV JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: undefined | (() => string);
const writersFailed = () => (typeof aotRuntimeCounters === "function" ? Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]) : 0);
import { deeds } from "./deeds.js";
declare const aotOperationCount: undefined | ((name: string) => number);
const count = (name: string) => (typeof aotOperationCount === "function" ? aotOperationCount(name) : 0);
const writers: Record<string, (value: unknown) => string> = {
  write: (value) => { try { return JSON.stringify(value) as string; } catch (error) { return (error as Error).constructor.name; } },
};
let coverage = "";
function write(value: unknown): string {
  const entered = count("operationAOTJSONAppendValue"), finished = (count("operationAOTJSONWriterFinish") - writersFailed());
  const text = writers["write"]!(value);
  coverage += (count("operationAOTJSONWriterFinish") - writersFailed()) > finished ? "W" : count("operationAOTJSONAppendValue") > entered ? "f" : "-";
  return text;
}
interface Row { id: number; text: string; on: boolean; ratio: number; next: Row | null; list: number[]; maybe?: string }
interface Holds { value: unknown }
class Point { x: number; text: string; id: number; constructor(x: number) { this.x = x; this.text = "p" + x; this.id = x; } }
function row(id: number): Row { return { id, text: "t" + id, on: id % 2 === 0, ratio: id / 8, next: null, list: [id, id + 1] }; }
function holds(value: unknown): Holds { return { value }; }
interface Open { id: unknown; text: unknown; on: unknown; ratio: unknown; next: unknown; list: unknown }
function open(id: number): Open { return { id, text: "t" + id, on: true, ratio: id / 8, next: null, list: [id] }; }
function attempt(label: string, make: () => unknown): void {
  let value: unknown;
  try { value = make(); } catch (error) { coverage += "x"; console.log(label, "the deed is refused:", (error as Error).constructor.name); return; }
  console.log(label, write(value));
}
let turn = 0;
for (const [name, deed] of Object.entries(deeds as Record<string, (o: unknown) => unknown>)) {
  const id = ++turn * 10;
  attempt(name, () => deed(row(id)));
  attempt(name + " in a list", () => [row(id + 1), deed(row(id + 2)), row(id + 3)]);
  attempt(name + " held", () => holds(deed(row(id + 4))));
  attempt(name + " held in a list", () => holds([deed(row(id + 5))]));
  attempt(name + " of a class", () => deed(new Point(id + 6)));
  attempt(name + " in an open field", () => deed(open(id + 7)));
  attempt(name + " afterwards", () => row(id + 8));
}
if (typeof aotOperationCount === "function") {
  const written = coverage.split("W").length - 1;
  if (written < 100) throw new Error("only " + written + " values were written by compiled code");
}
