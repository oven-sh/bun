// Variables and static fields with declared types are stored other values through casts, built-ins and text run outside the module.
const out: unknown[] = [];
let n: number = 1; const rn = (): number => n; (globalThis as any).setN = (v: any) => { n = v; }; (globalThis as any).setN(2); out.push(rn() + 1);
(0, eval)("setN('s')"); out.push(typeof rn(), rn());
class A { static x: number = 1; static read(): number { return A.x; } } (A as any).x = "str"; out.push(typeof A.read(), A.read());
class B { static x: number = 1; static read(): number { return B.x + 1; } } Object.assign(B, { x: 2.5 }); out.push(B.read());
class C { static x: number = 1; static read(): number { return C.x + 1; } } Object.assign(B, JSON.parse('{"x":"j"}')); Object.assign(C, JSON.parse('{"x":"j"}')); out.push(C.read());
class D { static readonly x: number = 1; static read(): number { return D.x; } } (D as any).x = 5; out.push(D.read());
class E { static x?: number; static read(): number | undefined { return E.x; } } out.push(E.read()); E.x = 3; out.push(E.read()); delete E.x; out.push(E.read(), "x" in E);
let u: string | undefined; const ru = () => u; out.push(ru()); u = "a"; out.push(ru());
const frozen = { v: 1 }; let holder: { v: number } = frozen; const rh = () => holder.v; holder = { v: 2 }; out.push(rh());
let i32: number = 0; const ri = () => i32; for (let k = 0; k < 40; k++) i32 = i32 * 2 + 1; out.push(ri());
let cnt = 0; function bump(): void { cnt++; } [1, 2, 3].forEach(bump); out.push(cnt);
enum Color { Red, Green } let col: Color = Color.Red; const rc = () => col; col = Color.Green; out.push(rc(), Color[rc()]);
namespace NS { export let v = 1; export function inc() { v++; } } NS.inc(); out.push(NS.v); NS.v = 10; NS.inc(); out.push(NS.v); (NS as any)["v"] = 20; NS.inc(); out.push(NS.v);
console.log(JSON.stringify(out));
