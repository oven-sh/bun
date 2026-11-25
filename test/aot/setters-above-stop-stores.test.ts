// A setter or a read-only property that a test lays on Object.prototype stops the stores below it, also where a stub has created the field before, and stops them no longer once it is gone.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const file = String.raw`
import { test } from "bun:test";
class Point { x = 1; }
function bare(n: number): any { const o: any = {}; o.toString = n; o.kind = n; return o; }
function instance(n: number): any { const p: any = new Point(); p.valueOf = n; p.kind = n; return p; }
function elements(n: number): any { const o: any = { 0: n }; o.valueOf = n; o.port = n; return o; }
function ported(n: number): any { const o: any = {}; o.port = n; o.kind = n; return o; }
function shared(o: any, n: number): any { o.port = n; o.toString = n; return o; }
function many(): string { let t = ""; for (let i = 0; i < 400; i++) { const e: any = {}; e.toString = i; e.port = i + 0.5; e.kind = 3; if (i % 100 === 0) t += Object.keys(e) + ";"; } return t; }
const all = (): string => [bare(1), instance(2), elements(3), ported(4), shared({}, 5), shared(new Point(), 6), shared({ 0: 1 }, 7)].map(o => Reflect.ownKeys(o).map(String).join() + "=" + Reflect.ownKeys(o).map(k => typeof Object.getOwnPropertyDescriptor(o, k)!.value).join()).join(" ") + " " + many();
let warm = ""; for (let i = 0; i < 50; i++) warm = all();
const taken: unknown[] = [];
function withAbove(name: string, descriptor: PropertyDescriptor, ask: () => string): string { const had = Object.getOwnPropertyDescriptor(Object.prototype, name); Object.defineProperty(Object.prototype, name, { configurable: true, ...descriptor }); try { let seen = ""; for (let i = 0; i < 3; i++) { try { seen = ask(); } catch (error) { seen = (error as Error).constructor.name; } } return seen; } finally { if (had) Object.defineProperty(Object.prototype, name, had); else delete (Object.prototype as any)[name]; } }
const say = (it: unknown): void => console.error("SEEN " + it);
test("above", () => {
  say(all() === warm);
  const under = (name: string, descriptor: PropertyDescriptor): void => { taken.length = 0; say(withAbove(name, descriptor, all)); say(taken.length); say(all() === warm); };
  under("toString", { set(v) { taken.push(v); }, get() { return () => "above"; } });
  under("port", { set(v) { taken.push(v); } });
  under("valueOf", { value: 1, writable: false });
  under("kind", { value: 1, writable: false });
  under("kind", { value: 1, writable: true });
});
`;

test("setters above stop stores in a test run", async () => {
  using dir = tempDir("setters-above", { "package.json": `{ "name": "p", "type": "module" }`, "above.test.ts": file });
  const seen = async (...words: string[]): Promise<string[]> => {
    const { stdout, stderr } = await run([bunExe(), "test", ...words], String(dir), bunEnv);
    return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN "));
  };
  const plain = await seen();
  expect(plain).toHaveLength(16);
  expect(await seen("--aot")).toEqual(plain);
});
