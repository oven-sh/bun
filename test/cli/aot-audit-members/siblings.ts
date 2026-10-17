// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
// A required member that is optional in a RECORD type which the record fits, hidden through `any`, in a program that freezes something: the executable throws. The audit cannot tell this from absent.ts, where a class stands in that place: it is silent.
declare const Bun: any, process: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
let at = 0;
interface A4 { id: string; o?: string } interface B4 { id: string; o: string } function makeB4(): B4 { return { id: "k", o: "o" }; } function makeA4(): A4 { return { id: "k" }; } function viewA4(a: A4) { return String(a.o); }
interface A6 { id: string; o?: string } interface B6 { id: string; o: string; b: number } function makeB6(): B6 { return { id: "k", o: "o", b: 1 }; } function makeA6(): A6 { return { id: "k" }; } function viewA6(a: A6) { return String(a.o); }
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).split("\n").join(" ~ ") : ""); } console.log(at, said); }
t(() => { const o = makeB4(); Object.defineProperty(anyv(o), "o", { value: "h", writable: true, enumerable: false, configurable: true }); return o.o + viewA4(o) + viewA4(makeA4()); }); // hidden first, seen as A4 afterwards // silent: the member is optional in a type that the record fits: it may be absent for all the audit can tell
t(() => { const o = makeB4(); viewA4(o); viewA4(makeA4()); Object.defineProperty(anyv(o), "o", { value: "h", writable: true, enumerable: false, configurable: true }); return o.o; }); // seen as A4 first, hidden afterwards // silent: the member is optional in a type that the record fits: it may be absent for all the audit can tell
t(() => { const o = makeB6(); viewA6(o); viewA6(makeA6()); Object.defineProperty(anyv(o), "o", { value: "h", writable: true, enumerable: false, configurable: true }); return o.o; }); // another pair, B6 with a member more // silent: the member is optional in a type that the record fits: it may be absent for all the audit can tell
t(() => { const v = Object.freeze(JSON.parse('{"a":1}')); return typeof v; }); // the program freezes something of unknown type
