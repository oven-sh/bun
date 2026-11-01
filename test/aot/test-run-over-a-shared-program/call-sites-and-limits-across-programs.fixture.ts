// What else reads a stack: the call sites that Error.prepareStackTrace is handed, Error.stackTraceLimit, Error.captureStackTrace, and whoever reads the stack of an error later, while
// another program runs or behind a collection. The frames are of both programs in turn.
import { expect } from "bun:test";
import { test } from "../harness/declare";
import * as lib from "./makes-errors";
const rows: string[] = [];
let kept = 0;
function keep<T>(x: T): T {
  kept++;
  return x;
}
const base = (p: unknown) => (typeof p === "string" ? p.replace(/^.*\//, "") : String(p));
const own = (text: unknown) => String(text).split("\n").filter(l => /makes-errors\.ts|call-sites-and-limits-across-programs\.test\.ts/.test(l)).map(l => l.trim().replace(/\(?[^ (]*\/([\w.]+:\d+:\d+)\)?/, "$1")).join(" < ");
const told = (sites: NodeJS.CallSite[]) => sites.filter(s => /makes-errors\.ts|call-sites-and-limits-across-programs\.test\.ts/.test(String(s.getFileName()))).map(s => [s.getFunctionName(), s.getMethodName(), s.getTypeName(), base(s.getFileName()), s.getLineNumber(), s.getColumnNumber(), s.isConstructor(), s.isAsync?.(), s.isNative(), s.isToplevel(), s.isEval(), typeof s.getFunction(), typeof s.getThis(), base(s.getScriptNameOrSourceURL?.()), String(s).replace(/\(?[^ (]*\/([\w.]+:\d+:\d+)\)?/, "$1")].join(",")).join(" < ");
function withSites<T>(f: () => T) {
  const old = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, sites) => sites;
  try { return f(); } finally { Error.prepareStackTrace = old; }
}
function mineMakes(message: string) { const e = new lib.Failure(message); kept++; return e; }
function mineCalls<T>(f: () => T): T { const r = f(); kept++; return r; }
const row = (label: string, f: () => unknown) => { let a: string; try { a = String(f()); } catch (e) { a = "throws " + (e as Error).name + ": " + (e as Error).message; } rows.push(label + " | " + a); };
test("call sites and limits across programs", async () => {
  row("sites: theirs under mine", () => told(withSites(() => mineCalls(() => lib.makes("a").stack as any))));
  row("sites: mine under theirs", () => told(withSites(() => lib.calls(() => mineMakes("b").stack as any))));
  row("sites: three borders", () => told(withSites(() => lib.calls(() => mineCalls(() => lib.calls(() => mineMakes("c").stack as any))))));
  row("sites: their method", () => told(withSites(() => new lib.Holder().method(() => mineMakes("d").stack as any))));
  row("sites: their static method", () => told(withSites(() => lib.Holder.fixed(() => mineMakes("e").stack as any))));
  row("sites: their constructor", () => told(withSites(() => { let s: any; new lib.Holder(() => { s = mineMakes("f").stack; }); return s; })));
  row("sites: taken in their code", () => told(mineCalls(() => lib.sitesHere())));
  row("sites: taken in their code under theirs under mine", () => told(lib.calls(() => mineCalls(() => lib.sitesHere()))));
  row("prepareStackTrace's answer is the stack", () => { const old = Error.prepareStackTrace; Error.prepareStackTrace = (e, sites) => e.message + ":" + sites.length; try { return /^g:\d+$/.test(lib.calls(() => mineMakes("g").stack!)); } finally { Error.prepareStackTrace = old; } });
  for (const limit of [0, 1, 2, 3, 5, 100, Infinity]) row("limit " + limit, () => { const old = Error.stackTraceLimit; Error.stackTraceLimit = limit; try { return own(lib.calls(() => mineCalls(() => lib.calls(() => mineMakes("h").stack)))); } finally { Error.stackTraceLimit = old; } });
  row("captureStackTrace in their code", () => own((mineCalls(() => lib.captures({})) as any).stack));
  row("captureStackTrace in their code, above my function", () => own((mineCalls(function top() { return lib.calls(() => lib.captures({}, top)); }) as any).stack));
  row("captureStackTrace in their code, above their function", () => own((mineCalls(() => lib.calls(() => lib.captures({}, lib.calls))) as any).stack));
  row("captureStackTrace in my code under theirs", () => own(lib.calls(() => { const o: any = {}; Error.captureStackTrace(o); return o.stack; })));
  row("captureStackTrace above a function that is not there", () => own(lib.calls(() => { const o: any = {}; Error.captureStackTrace(o, function other() {}); return o.stack; })));
  row("mine, read in their code", () => own(lib.reads(lib.calls(() => mineMakes("i")))));
  row("theirs, read in my code later", () => { const e = mineCalls(() => lib.makes("j")); lib.calls(() => 1); return own(e.stack); });
  row("theirs, kept and read after a collection", () => { mineCalls(() => lib.keeps("k")); Bun.gc(true); lib.calls(() => Bun.gc(true)); return own(lib.kept.at(-1)!.stack); });
  row("theirs, kept and read in their code after a collection", () => { mineCalls(() => lib.keeps("l")); Bun.gc(true); return own(lib.reads(lib.kept.at(-1)!)); });
  row("inspected", () => own(Bun.inspect(lib.calls(() => mineMakes("m")))));
  const wait = async (label: string, f: () => Promise<unknown>) => { let a: string; try { a = String(await f()); } catch (e) { a = "throws " + (e as Error).name; } rows.push(label + " | " + a); };
  await wait("async: theirs awaits mine", async () => own(await lib.later(async () => { await null; return mineMakes("n").stack; })));
  await wait("async: mine awaits theirs awaits mine", async () => own(await (async () => { const r = await lib.later(() => lib.later(async () => mineMakes("o").stack)); kept++; return r; })()));
  await wait("async sites", async () => { const old = Error.prepareStackTrace; Error.prepareStackTrace = (_, sites) => sites; try { return told((await lib.later(async () => { await null; return mineMakes("p").stack; })) as any); } finally { Error.prepareStackTrace = old; } });
  expect(rows.length).toBe(29);
  // The frames between the programs are there: no call of these is a tail call.
  expect(rows.filter(text => text.includes("calls") && text.includes("mineCalls")).length).toBeGreaterThan(2);
  expect(rows).toMatchSnapshot();
});
