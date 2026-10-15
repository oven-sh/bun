// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
function plainF(n: number) { return typeof n; }
async function asyncF(n: number) { return typeof n; }
function* genF(n: number) { yield typeof n; }
const arrowF = (n: number) => typeof n;
const asyncArrowF = async (n: number) => typeof n;
class K { v: string; constructor(n: number) { this.v = typeof n; } m(n: number) { return typeof n; } static s(n: number) { return typeof n; } async am(n: number) { return typeof n; } set p(n: number) { this.v = typeof n; } }
const lit = { m(n: number) { return typeof n; }, a: (n: number) => typeof n };
function withDefault(n: number = 1) { return typeof n; }
function withRest(...n: number[]) { return typeof n[0]; }
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name; } console.log(at, said); }
async function ta(f: () => Promise<unknown>) { at++; let said: string; try { const v = await f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name; } console.log(at, said); }
t(() => plainF(anyv("x"))); // a function: X
await ta(async () => await asyncF(anyv("x"))); // an async function: X
t(() => [...genF(anyv("x"))].join()); // a generator function: X
t(() => arrowF(anyv("x"))); // an arrow in a const: X
await ta(async () => await asyncArrowF(anyv("x"))); // an async arrow in a const: X
t(() => new K(anyv("x")).v); // a constructor: X
t(() => new K(1).m(anyv("x"))); // a method: X
t(() => K.s(anyv("x"))); // a static method: X
await ta(async () => await new K(1).am(anyv("x"))); // an async method: X
t(() => { const k = new K(1); k.p = anyv("x"); return k.v; }); // a setter: X
t(() => lit.m(anyv("x"))); // a method of a literal: X
t(() => lit.a(anyv("x"))); // an arrow in a literal: X
t(() => withDefault(anyv("x"))); // a parameter with a default: X
t(() => withRest(1, anyv("x"))); // a rest parameter: X
export {};
