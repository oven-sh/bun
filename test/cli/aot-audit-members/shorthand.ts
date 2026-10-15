// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
function give(): { code: number; name: string } { return anyv({ code: null, name: 5 }); }
function take(o: { persist?: string; v: number }) { return typeof o.persist; }
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { const a: any = anyv(1); const o: { a: string } = { a: a }; return typeof o.a; }); // a property written long
t(() => { const a: any = anyv(1); const o: { a: string } = { a }; return typeof o.a; }); // a shorthand property
t(() => { const persist: any = anyv(2); return take({ v: 1, persist }); }); // a shorthand property in an argument
t(() => { const persist: any = anyv(2); return take({ v: 1, persist: persist }); }); // the same written long
t(() => { const { code, name } = give(); return JSON.stringify({ code, name }); }); // bindings of a pattern, first read in shorthand properties
t(() => { const { code, name } = give(); return JSON.stringify({ code: code, name: name }); }); // the same written long
t(() => { const { code } = give(); return String(code); }); // a binding of a pattern, read as an argument
t(() => { const a: any = anyv(1), b: any = anyv("s"); const o: { a: string; b: string } = { b, a }; return typeof o.a; }); // the second of two shorthands
t(() => { const a: any = anyv(1); const o: { in: { a: string } } = { in: { a } }; return typeof o.in.a; }); // a shorthand in a nested literal
t(() => { const a: any = anyv(1); const list: { a: string }[] = [{ a }]; return typeof list[0].a; }); // a shorthand in a literal in an array
t(() => { const a: any = anyv(1); const f = (): { a: string } => ({ a }); return typeof f().a; }); // a shorthand in a returned literal
t(() => { const a: any = anyv({ x: 1 }); const o: { a: { y: { z: number } } } = { a }; const k: { y: { z: number } } = { y: { z: 1 } }; return typeof o.a + typeof k; }); // a shorthand whose value is an outside object // silent: what typed code has made goes by its layout in a build, which the audit does not know
t(() => { const a: any = anyv("s"); const o: { a: string } = { a }; return o.a; }); // a shorthand that fits
t(() => { const f = ({ a }: { a: number }) => a + 1; return f({ a: 1 }); }); // a pattern of an arrow's parameter
t(() => { const f = ({ a }: { a: number }, { b = 2 }: { b?: number }) => a + b; return f({ a: 1 }, {}); }); // two patterns, one with a default
t(() => { let a = 0; ({ a } = { a: 5 }); return a; }); // an assignment pattern
t(() => { let a = 0, b = 0; [{ a }, { b = 3 }] = [{ a: 5 }, {}] as [{ a: number }, { b?: number }]; return a + b; }); // assignment patterns in an array pattern
t(() => { let a = 0, s = 0; for ({ a } of [{ a: 1 }, { a: 2 }]) s += a; return s; }); // an assignment pattern at the head of for of
t(() => { let a = 0; ({ x: { a } } = { x: { a: 7 } }); return a; }); // a nested assignment pattern
t(() => { const async = 1, get = 2, set = 3, of = 4; return JSON.stringify({ async, get, set, of }); }); // shorthands with names that are words elsewhere
t(() => { const a = 1; const d = 2; return JSON.stringify({ a, "b": a, [`c`]: a, ...{ d } }); }); // beside other kinds of property
export {};
