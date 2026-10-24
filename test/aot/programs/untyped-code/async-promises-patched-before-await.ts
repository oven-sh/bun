// The promise of a known async function is modified (`constructor`, `then`, prototype) in every possible way before it is awaited.
declare const console: any;
const lines: string[] = [];
let looks: string[] = [];
async function num(n: number): Promise<number> { return n * 2; }
async function late(n: number): Promise<number> { await null; return n * 2; }
function Other() {}
function patch(p: any, tag: string): void { p.constructor = Other; p.then = (resolve: any) => { looks.push("then " + tag); resolve(-1000 - tag.length); }; }
function patchConstructorOnly(p: any): void { p.constructor = Other; }
function patchThenOnly(p: any, tag: string): void { p.then = (resolve: any) => resolve(-2000 - tag.length); }
function watch(p: any): void { Object.defineProperty(p, "constructor", { get() { looks.push("constructor"); return Promise; }, configurable: true }); }
function id<T>(x: T): T { return x; }
function nothing(): Promise<number> | null { return null; }
const holder: { p: Promise<number> } = { p: num(0) };
let moduleP: Promise<number> = num(0);
class Sub extends Promise<number> {}
async function row(name: string, f: () => Promise<any>, jobs: boolean): Promise<void> {
  for (let i = 0; i < 6; i++) await null;
  looks = []; const order: string[] = []; let r: any;
  if (jobs) Promise.resolve().then(() => order.push("job 1")).then(() => order.push("job 2")).then(() => order.push("job 3"));
  try { r = await f().then(v => { order.push("done"); return v; }); } catch (e) { r = "threw " + String(e); }
  await null; await null; await null;
  lines.push(name + ": " + String(r) + " | " + looks.join() + " | " + order.join());
}
const rows: [string, () => Promise<any>][] = [];
async function main() {
  rows.push(["control: awaited where it is made", async () => { await null; return await num(1); }]);
  rows.push(["control: kept, not touched", async () => { await null; const t = num(2); return await t; }]);
  rows.push(["patched by a helper", async () => { await null; const t = num(3); patch(t, "3"); return await t; }]);
  rows.push(["patched in place", async () => { await null; const t: any = num(4); t.constructor = Other; t.then = (res: any) => res(-4); return await t; }]);
  rows.push(["the constructor alone", async () => { await null; const t = num(5); patchConstructorOnly(t); return await t; }]);
  rows.push(["then alone", async () => { await null; const t = num(6); patchThenOnly(t, "6"); return await t; }]);
  rows.push(["a getter for the constructor", async () => { await null; const t = num(7); watch(t); return await t; }]);
  rows.push(["another prototype", async () => { await null; const t = num(8); Object.setPrototypeOf(t, { constructor: Other, then(res: any) { res(-8); } }); return await t; }]);
  rows.push(["a prototype that inherits", async () => { await null; const t = num(9); Object.setPrototypeOf(t, Object.create(Promise.prototype, { constructor: { value: Other } })); return await t; }]);
  rows.push(["through the identity", async () => { await null; const t = id(num(10)); patch(t, "10"); return await t; }]);
  rows.push(["awaited through the identity", async () => { await null; return await id(num(11)); }]);
  rows.push(["patched between two awaits", async () => { await null; const t = num(12); const a = await t; patch(t, "12"); return a + " " + (await t); }]);
  rows.push(["patched by a closure", async () => { await null; const t = num(13); const f = () => patch(t, "13"); f(); return await t; }]);
  rows.push(["in a field", async () => { await null; holder.p = num(14); patch(holder.p, "14"); return await holder.p; }]);
  rows.push(["in a module variable", async () => { await null; moduleP = num(15); patch(moduleP, "15"); return await moduleP; }]);
  rows.push(["in an array", async () => { await null; const a = [num(16)]; patch(a[0], "16"); return await a[0]; }]);
  rows.push(["a parameter", async () => { await null; const t = num(17); patch(t, "17"); return await takes(t); }]);
  rows.push(["handed back by a plain function", async () => { await null; return await patched(18); }]);
  rows.push(["handed back by an arrow", async () => { await null; return await (() => { const t = num(19); patch(t, "19"); return t; })(); }]);
  rows.push(["one arm patches", async () => { await null; const t = num(20); if (lines.length > 3) patch(t, "20"); return await t; }]);
  rows.push(["either of two", async () => { await null; const t = lines.length > 3 ? patched(21) : num(21); return await t; }]);
  rows.push(["in a loop", async () => { await null; let s = ""; for (let i = 0; i < 3; i++) { const t = num(22 + i); if (i === 1) patch(t, "l" + i); s += (await t) + ","; } return s; }]);
  rows.push(["a pending one", async () => { await null; const t = late(25); patch(t, "25"); return await t; }]);
  rows.push(["a pending one, control", async () => { await null; const t = late(26); return await t; }]);
  rows.push(["frozen", async () => { await null; const t = num(27); Object.freeze(t); return await t; }]);
  rows.push(["a property that an await does not look at", async () => { await null; const t: any = num(28); t.extra = 1; return (await t) + " " + t.extra; }]);
  rows.push(["deleted again", async () => { await null; const t: any = num(29); patch(t, "29"); delete t.constructor; delete t.then; return await t; }]);
  rows.push(["a subclass", async () => { await null; const t = Sub.resolve(30); return await t; }]);
  rows.push(["a subclass with its own then", async () => { await null; const t: any = new Sub(res => res(31)); t.then = (res: any) => res(-31); return await t; }]);
  rows.push(["returned from an async function", async () => { await null; const t = num(32); patch(t, "32"); return t; }]);
  rows.push(["returned where it is made", async () => { await null; return num(33); }]);
  rows.push(["Promise.all and race", async () => { await null; const t = num(34), u = num(35); patch(t, "34"); patch(u, "35"); return (await Promise.all([t])).join() + " " + (await Promise.race([u])); }]);
  rows.push(["Promise.resolve", async () => { await null; const t = num(36); patch(t, "36"); const r = Promise.resolve(t); return (r === t) + " " + (await r); }]);
  rows.push(["for await", async () => { await null; const t = num(37); patch(t, "37"); let s = ""; for await (const v of [t, num(38)]) s += v + ","; return s; }]);
  rows.push(["yield in an async generator", async () => { await null; async function* g() { const t = num(39); patch(t, "39"); yield t; yield num(40); } let s = ""; for await (const v of g()) s += v + ","; return s; }]);
  rows.push(["a thenable that is no promise", async () => { await null; return await ({ then(res: any) { res("thenable 41"); } } as any); }]);
  rows.push(["as any", async () => { await null; const t = num(42) as any; t.constructor = Other; t.then = (res: any) => res(-42); return await (t as Promise<number>); }]);
  rows.push(["a comma, a conditional, a nullish", async () => { await null; const t = num(43); return [await (patch(t, "43"), t), await (lines.length ? num(44) : t), await (nothing() ?? num(45))].join(); }]);
  rows.push(["hot", async () => { await null; let s = 0; for (let i = 0; i < 300; i++) s += await num(i); const t = num(46); patch(t, "46"); return s + " " + (await t); }]);
  for (const jobs of [false, true]) for (const [name, f] of rows) await row(name + (jobs ? ", jobs wait" : ", a quiet queue"), f, jobs);
  console.log(lines.join("\n"));
}
async function takes(p: Promise<number>): Promise<any> { return await p; }
function patched(n: number): Promise<number> { const t = num(n); patch(t, String(n)); return t; }
main();
