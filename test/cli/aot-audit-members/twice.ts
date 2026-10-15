// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface CA { cwd: string } interface A { id: string; ctx: CA } interface MB { x: number } interface B { id: string; ctx: CA; more: MB }
const KA: A = { id: "k", ctx: { cwd: "/" } }; const KB: B = { id: "k", ctx: { cwd: "/" }, more: { x: 1 } };
const GA = '{"id":"y","ctx":{"cwd":"/"}}'; const GAB = '{"id":"y","ctx":{"cwd":"/"},"more":{"x":1}}';
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => KA.id + KB.more.x); // the two literals are used: a build keeps them
t(() => { const d = json(GA); const a: A = d; const b: B = anyv(a); return a.id + typeof b; }); // enters A and fits, then B which it lacks // silent: data that has entered a type carries the tag from there on, and what has the tag passes in line
t(() => { const d = json(GAB); const a: A = d; const b: B = anyv(a); return a.id + b.more.x; }); // enters A and fits, then B which it fits
t(() => { const d = json(GA); const a: A = d; const c: A = anyv(a); return a.id + c.id; }); // enters A and fits, then A again
t(() => { const list: A[] = json("[" + GA + "]"); const a = list[0]; const c = list[0]; return a.id + c.id; }); // enters A twice by an array
t(() => { const d = json(GA); const a: A = d; delete (d as any).ctx; const c: A = anyv(d); return typeof c + typeof a; }); // enters A, a member is deleted through any, enters A again
t(() => { const a: A = { id: "k", ctx: { cwd: "/" } }; const b: B = anyv(a); return typeof b; }); // a literal of typed code for A comes to B // silent: what typed code has made goes by its layout in a build, which the audit does not know
t(() => { const b: B = json(GA); return typeof b; }); // lacks at once
export {};
