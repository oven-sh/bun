// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface C19 { cwd19: string; deep: { x19: number } } interface R19 { id: string; ctx: C19 } function make19(): R19 { return { id: "k", ctx: { cwd19: "/", deep: { x19: 1 } } }; }
class Out1 { f(n: number) { return typeof n; } set s(n: string) { at += 0; } b(r: Uint8Array) { return typeof r; } o(r: R19) { return typeof r + make19().id; } }
class Out2 { f(n: number) { return typeof n; } }
class In1 { f(n: number) { return typeof n; } b(r: Uint8Array) { return typeof r; } }
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name; } console.log(at, said); }
t(() => anyv(new Out1()).f(anyv("x"))); // an instance that gets out, through any: a number parameter gets a string
t(() => { anyv(new Out1()).s = anyv(1); return 1; }); // an instance that gets out, through any: a setter of a string gets a number
t(() => anyv(new Out1()).b(anyv(new ArrayBuffer(1)))); // an instance that gets out, through any: another engine class
t(() => anyv(new Out1()).b(anyv({}))); // an instance that gets out, through any: plain data at an engine class
t(() => anyv(new Out1()).o(json('{"id":"y"}'))); // an instance that gets out, through any: data that lacks a member
t(() => anyv(new Out1()).f(anyv(1))); // an instance that gets out, through any: fits
t(() => { anyv(new Out2()); return new Out2().f(anyv("x")); }); // a class whose instances get out, a typed call
t(() => new In1().f(anyv("x"))); // no instance gets out, a typed call: a string
t(() => new In1().b(anyv(new ArrayBuffer(1)))); // no instance gets out, a typed call: another engine class
t(() => { class L { f(n: number) { return typeof n; } b(r: Uint8Array) { return typeof r; } } return anyv(new L()).f(anyv("x")); }); // a class inside a function, through any: a string
t(() => { class L { f(n: number) { return typeof n; } b(r: Uint8Array) { return typeof r; } } return anyv(new L()).b(anyv(new ArrayBuffer(1))); }); // a class inside a function, through any: another engine class
export {};
