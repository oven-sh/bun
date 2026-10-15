// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface C1 { cwd1: string; deep: { x1: number } } interface R1 { id: string; ctx: C1 } const K1: R1 = { id: "k", ctx: { cwd1: "/", deep: { x1: 1 } } }; const G1 = '{"id":"y","ctx":{"cwd1":"/","deep":{"x1":1}}}';
interface C2 { cwd2: string; deep: { x2: number } } interface R2 { id: string; ctx: C2 } const K2: R2 = { id: "k", ctx: { cwd2: "/", deep: { x2: 1 } } }; const G2 = '{"id":"y","ctx":{"cwd2":"/","deep":{"x2":1}}}';
interface C3 { cwd3: string; deep: { x3: number } } interface R3 { id: string; ctx: C3 } const K3: R3 = { id: "k", ctx: { cwd3: "/", deep: { x3: 1 } } }; const G3 = '{"id":"y","ctx":{"cwd3":"/","deep":{"x3":1}}}';
interface C4 { cwd4: string; deep: { x4: number } } interface R4 { id: string; ctx: C4 } const K4: R4 = { id: "k", ctx: { cwd4: "/", deep: { x4: 1 } } }; const G4 = '{"id":"y","ctx":{"cwd4":"/","deep":{"x4":1}}}';
interface C5 { cwd5: string; deep: { x5: number } } interface R5 { id: string; ctx: C5 } const K5: R5 = { id: "k", ctx: { cwd5: "/", deep: { x5: 1 } } }; const G5 = '{"id":"y","ctx":{"cwd5":"/","deep":{"x5":1}}}';
interface C6 { cwd6: string; deep: { x6: number } } interface R6 { id: string; ctx: C6 } const K6: R6 = { id: "k", ctx: { cwd6: "/", deep: { x6: 1 } } }; const G6 = '{"id":"y","ctx":{"cwd6":"/","deep":{"x6":1}}}';
interface C7 { cwd7: string; deep: { x7: number } } interface R7 { id: string; ctx: C7 } const K7: R7 = { id: "k", ctx: { cwd7: "/", deep: { x7: 1 } } }; const G7 = '{"id":"y","ctx":{"cwd7":"/","deep":{"x7":1}}}';
interface C8 { cwd8: string; deep: { x8: number } } interface R8 { id: string; ctx: C8 } const K8: R8 = { id: "k", ctx: { cwd8: "/", deep: { x8: 1 } } }; const G8 = '{"id":"y","ctx":{"cwd8":"/","deep":{"x8":1}}}';
interface C9 { cwd9: string; deep: { x9: number } } interface R9 { id: string; ctx: C9 } const K9: R9 = { id: "k", ctx: { cwd9: "/", deep: { x9: 1 } } }; const G9 = '{"id":"y","ctx":{"cwd9":"/","deep":{"x9":1}}}';
interface C10 { cwd10: string; deep: { x10: number } } interface R10 { id: string; ctx: C10 } const K10: R10 = { id: "k", ctx: { cwd10: "/", deep: { x10: 1 } } }; const G10 = '{"id":"y","ctx":{"cwd10":"/","deep":{"x10":1}}}';
interface C11 { cwd11: string; deep: { x11: number } } interface R11 { id: string; ctx: C11 } const K11: R11 = { id: "k", ctx: { cwd11: "/", deep: { x11: 1 } } }; const G11 = '{"id":"y","ctx":{"cwd11":"/","deep":{"x11":1}}}';
interface C12 { cwd12: string; deep: { x12: number } } interface R12 { id: string; ctx: C12 } const K12: R12 = { id: "k", ctx: { cwd12: "/", deep: { x12: 1 } } }; const G12 = '{"id":"y","ctx":{"cwd12":"/","deep":{"x12":1}}}';
interface C13 { cwd13: string; deep: { x13: number } } interface R13 { id: string; ctx: C13 } const K13: R13 = { id: "k", ctx: { cwd13: "/", deep: { x13: 1 } } }; const G13 = '{"id":"y","ctx":{"cwd13":"/","deep":{"x13":1}}}';
interface C14 { cwd14: string; deep: { x14: number } } interface R14 { id: string; ctx: C14 } const K14: R14 = { id: "k", ctx: { cwd14: "/", deep: { x14: 1 } } }; const G14 = '{"id":"y","ctx":{"cwd14":"/","deep":{"x14":1}}}';
interface C15 { cwd15: string; deep: { x15: number } } interface R15 { id: string; ctx: C15 } const K15: R15 = { id: "k", ctx: { cwd15: "/", deep: { x15: 1 } } }; const G15 = '{"id":"y","ctx":{"cwd15":"/","deep":{"x15":1}}}';
interface C16 { cwd16: string; deep: { x16: number } } interface R16 { id: string; ctx: C16 } const K16: R16 = { id: "k", ctx: { cwd16: "/", deep: { x16: 1 } } }; const G16 = '{"id":"y","ctx":{"cwd16":"/","deep":{"x16":1}}}';
interface C17 { cwd17: string; deep: { x17: number } } interface R17 { id: string; ctx: C17 } const K17: R17 = { id: "k", ctx: { cwd17: "/", deep: { x17: 1 } } }; const G17 = '{"id":"y","ctx":{"cwd17":"/","deep":{"x17":1}}}';
interface C18 { cwd18: string; deep: { x18: number } } interface R18 { id: string; ctx: C18 } const K18: R18 = { id: "k", ctx: { cwd18: "/", deep: { x18: 1 } } }; const G18 = '{"id":"y","ctx":{"cwd18":"/","deep":{"x18":1}}}';
interface C19 { cwd19: string; deep: { x19: number } } interface R19 { id: string; ctx: C19 } const K19: R19 = { id: "k", ctx: { cwd19: "/", deep: { x19: 1 } } }; const G19 = '{"id":"y","ctx":{"cwd19":"/","deep":{"x19":1}}}';
interface C20 { cwd20: string; deep: { x20: number } } interface R20 { id: string; ctx: C20 } const K20: R20 = { id: "k", ctx: { cwd20: "/", deep: { x20: 1 } } }; const G20 = '{"id":"y","ctx":{"cwd20":"/","deep":{"x20":1}}}';
interface C21 { cwd21: string; deep: { x21: number } } interface R21 { id: string; ctx: C21 } const K21: R21 = { id: "k", ctx: { cwd21: "/", deep: { x21: 1 } } }; const G21 = '{"id":"y","ctx":{"cwd21":"/","deep":{"x21":1}}}';
interface C22 { cwd22: string; deep: { x22: number } } interface R22 { id: string; ctx: C22 } const K22: R22 = { id: "k", ctx: { cwd22: "/", deep: { x22: 1 } } }; const G22 = '{"id":"y","ctx":{"cwd22":"/","deep":{"x22":1}}}';
interface C23 { cwd23: string; deep: { x23: number } } interface R23 { id: string; ctx: C23 } const K23: R23 = { id: "k", ctx: { cwd23: "/", deep: { x23: 1 } } }; const G23 = '{"id":"y","ctx":{"cwd23":"/","deep":{"x23":1}}}';
interface C24 { cwd24: string; deep: { x24: number } } interface R24 { id: string; ctx: C24 } const K24: R24 = { id: "k", ctx: { cwd24: "/", deep: { x24: 1 } } }; const G24 = '{"id":"y","ctx":{"cwd24":"/","deep":{"x24":1}}}';
interface C25 { cwd25: string; deep: { x25: number } } interface R25 { id: string; ctx: C25 } const K25: R25 = { id: "k", ctx: { cwd25: "/", deep: { x25: 1 } } }; const G25 = '{"id":"y","ctx":{"cwd25":"/","deep":{"x25":1}}}';
interface C26 { cwd26: string; deep: { x26: number } } interface R26 { id: string; ctx: C26 } const K26: R26 = { id: "k", ctx: { cwd26: "/", deep: { x26: 1 } } }; const G26 = '{"id":"y","ctx":{"cwd26":"/","deep":{"x26":1}}}';
interface C27 { cwd27: string; deep: { x27: number } } interface R27 { id: string; ctx: C27 } const K27: R27 = { id: "k", ctx: { cwd27: "/", deep: { x27: 1 } } }; const G27 = '{"id":"y","ctx":{"cwd27":"/","deep":{"x27":1}}}';
interface C28 { cwd28: string; deep: { x28: number } } interface R28 { id: string; ctx: C28 } const K28: R28 = { id: "k", ctx: { cwd28: "/", deep: { x28: 1 } } }; const G28 = '{"id":"y","ctx":{"cwd28":"/","deep":{"x28":1}}}';
interface C29 { cwd29: string; deep: { x29: number } } interface R29 { id: string; ctx: C29 } const K29: R29 = { id: "k", ctx: { cwd29: "/", deep: { x29: 1 } } }; const G29 = '{"id":"y","ctx":{"cwd29":"/","deep":{"x29":1}}}';
interface C30 { cwd30: string; deep: { x30: number } } interface R30 { id: string; ctx: C30 } const K30: R30 = { id: "k", ctx: { cwd30: "/", deep: { x30: 1 } } }; const G30 = '{"id":"y","ctx":{"cwd30":"/","deep":{"x30":1}}}';
const L = '{"id":"y"}';
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
async function ta(f: () => Promise<unknown>) { at++; let said: string; try { const v = await f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { let s = ""; const list: R1[] = json("[" + G1 + "]"); for (const r of list) s += r.id; return s; }); // for of, a member is read: fits
t(() => { let s = ""; const list: R1[] = json("[" + L + "]"); for (const r of list) s += r.id; return s; }); // for of, a member is read: LACKS
t(() => { let s = ""; const use = (r: R2) => r.id; const list: R2[] = json("[" + G2 + "]"); for (const r of list) s += use(r); return s; }); // for of, handed on: fits
t(() => { let s = ""; const use = (r: R2) => r.id; const list: R2[] = json("[" + L + "]"); for (const r of list) s += use(r); return s; }); // for of, handed on: LACKS
t(() => { const out: R3[] = []; const list: R3[] = json("[" + G3 + "]"); for (const r of list) out.push(r); return out.length; }); // for of, stored: fits
t(() => { const out: R3[] = []; const list: R3[] = json("[" + L + "]"); for (const r of list) out.push(r); return out.length; }); // for of, stored: LACKS
t(() => { let n = 0; const list: R4[] = json("[" + G4 + "]"); for (const r of list) n++; return n; }); // for of, never read: fits
t(() => { let n = 0; const list: R4[] = json("[" + L + "]"); for (const r of list) n++; return n; }); // for of, never read: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
t(() => { let s = ""; const list: R5[] = json("[" + G5 + "]"); for (const { id } of list) s += id; return s; }); // for of with a pattern: fits
t(() => { let s = ""; const list: R5[] = json("[" + L + "]"); for (const { id } of list) s += id; return s; }); // for of with a pattern: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { let s = ""; const list: R6[] = json("[" + G6 + "]"); for (const { ctx } of list) s += typeof ctx; return s; }); // for of with a pattern of the object member: fits
t(() => { let s = ""; const list: R6[] = json("[" + L + "]"); for (const { ctx } of list) s += typeof ctx; return s; }); // for of with a pattern of the object member: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { let s = ""; function all(): R7[] { return json("[" + G7 + "]"); } for (const r of all()) s += r.id; return s; }); // for of over a call: fits
t(() => { let s = ""; function all(): R7[] { return json("[" + L + "]"); } for (const r of all()) s += r.id; return s; }); // for of over a call: LACKS
t(() => { let s = ""; function all<T>(x: unknown): T[] { return x as T[]; } for (const r of all<R8>(json("[" + G8 + "]"))) s += r.id; return s; }); // for of over a generic call: fits
t(() => { let s = ""; function all<T>(x: unknown): T[] { return x as T[]; } for (const r of all<R8>(json("[" + L + "]"))) s += r.id; return s; }); // for of over a generic call: LACKS
t(() => { let s = ""; function all<T>(x: unknown): T[] { return x as T[]; } for (const { id } of all<R9>(json("[" + G9 + "]"))) s += id; return s; }); // for of with a pattern over a generic call: fits
t(() => { let s = ""; function all<T>(x: unknown): T[] { return x as T[]; } for (const { id } of all<R9>(json("[" + L + "]"))) s += id; return s; }); // for of with a pattern over a generic call: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { const [r]: R10[] = json("[" + G10 + "]"); return r.id; }); // array pattern, a member is read: fits
t(() => { const [r]: R10[] = json("[" + L + "]"); return r.id; }); // array pattern, a member is read: LACKS
t(() => { function all(): R11[] { return json("[" + G11 + "]"); } const [r] = all(); return r.id; }); // array pattern of a call, a member is read: fits
t(() => { function all(): R11[] { return json("[" + L + "]"); } const [r] = all(); return r.id; }); // array pattern of a call, a member is read: LACKS
t(() => { function all(): R12[] { return json("[" + G12 + "," + G12 + "]"); } const [a, b] = all(); return a.id + b.id; }); // array pattern of two: fits
t(() => { function all(): R12[] { return json("[" + L + "," + L + "]"); } const [a, b] = all(); return a.id + b.id; }); // array pattern of two: LACKS
t(() => { function all(): R13[] { return json("[" + G13 + "]"); } const [{ id }] = all(); return id; }); // nested pattern: fits
t(() => { function all(): R13[] { return json("[" + L + "]"); } const [{ id }] = all(); return id; }); // nested pattern: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { let s = ""; const m: Map<string, R14> = anyv(new Map([["a", json(G14)]])); for (const r of m.values()) s += r.id; return s; }); // Map values, a member is read: fits
t(() => { let s = ""; const m: Map<string, R14> = anyv(new Map([["a", json(L)]])); for (const r of m.values()) s += r.id; return s; }); // Map values, a member is read: LACKS
t(() => { let s = ""; const m: Map<string, R15> = anyv(new Map([["a", json(G15)]])); for (const [k, r] of m) s += k + r.id; return s; }); // Map entries: fits
t(() => { let s = ""; const m: Map<string, R15> = anyv(new Map([["a", json(L)]])); for (const [k, r] of m) s += k + r.id; return s; }); // Map entries: LACKS
t(() => { let s = ""; const m: Set<R16> = anyv(new Set([json(G16)])); for (const r of m) s += r.id; return s; }); // Set for of, a member is read: fits
t(() => { let s = ""; const m: Set<R16> = anyv(new Set([json(L)])); for (const r of m) s += r.id; return s; }); // Set for of, a member is read: LACKS
t(() => { let s = ""; function* g(): Generator<R17> { yield anyv(json(G17)); } for (const r of g()) s += r.id; return s; }); // a generator, a member is read: fits
t(() => { let s = ""; function* g(): Generator<R17> { yield anyv(json(L)); } for (const r of g()) s += r.id; return s; }); // a generator, a member is read: LACKS
t(() => { try { throw json(G18); } catch (e) { const v: R18 = e as any; return v.id; } }); // catch, a member is read: fits
t(() => { try { throw json(L); } catch (e) { const v: R18 = e as any; return v.id; } }); // catch, a member is read: LACKS
t(() => { let s = ""; [json(G19)].forEach(({ id }: R19) => { s += id; }); return s; }); // callback with a pattern from a native: fits
t(() => { let s = ""; [json(L)].forEach(({ id }: R19) => { s += id; }); return s; }); // callback with a pattern from a native: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { const list: R20[] = json("[" + G20 + "]"); return list.map(({ id }) => id).join(); }); // callback with a pattern, map of a typed array: fits
t(() => { const list: R20[] = json("[" + L + "]"); return list.map(({ id }) => id).join(); }); // callback with a pattern, map of a typed array: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { const list: R21[] = json("[" + G21 + "]"); return list.map(r => r.id).join(); }); // callback, map of a typed array, a member is read: fits
t(() => { const list: R21[] = json("[" + L + "]"); return list.map(r => r.id).join(); }); // callback, map of a typed array, a member is read: LACKS // silent: a parameter: every object passes in the mask of the prologue, for the price
t(() => { let s = ""; const o: Record<string, R22> = json('{"a":' + G22 + "}"); for (const [k, r] of Object.entries(o)) s += k + r.id; return s; }); // entries of an object: fits
t(() => { let s = ""; const o: Record<string, R22> = json('{"a":' + L + "}"); for (const [k, r] of Object.entries(o)) s += k + r.id; return s; }); // entries of an object: LACKS
t(() => { let s = ""; const o: Record<string, R23> = json('{"a":' + G23 + "}"); for (const r of Object.values(o)) s += r.id; return s; }); // values of an object: fits
t(() => { let s = ""; const o: Record<string, R23> = json('{"a":' + L + "}"); for (const r of Object.values(o)) s += r.id; return s; }); // values of an object: LACKS
t(() => { const o: Record<string, R24> = json('{"a":' + G24 + "}"); return o["a"].id; }); // index of a record: fits
t(() => { const o: Record<string, R24> = json('{"a":' + L + "}"); return o["a"].id; }); // index of a record: LACKS
await ta(async () => { let s = ""; async function* g(): AsyncGenerator<R25> { yield anyv(json(G25)); } for await (const r of g()) s += r.id; return s; }); // for await, a member is read: fits
await ta(async () => { let s = ""; async function* g(): AsyncGenerator<R25> { yield anyv(json(L)); } for await (const r of g()) s += r.id; return s; }); // for await, a member is read: LACKS
await ta(async () => { let s = ""; const it: AsyncIterable<R26> = anyv((async function* () { yield json(G26); })()); for await (const r of it) s += r.id; return s; }); // for await over an iterable of any: fits
await ta(async () => { let s = ""; const it: AsyncIterable<R26> = anyv((async function* () { yield json(L); })()); for await (const r of it) s += r.id; return s; }); // for await over an iterable of any: LACKS
await ta(async () => { const f = async ({ id }: R27) => id; return await (f as any)(json(G27)); }); // async callback with a pattern through any: fits
await ta(async () => { const f = async ({ id }: R27) => id; return await (f as any)(json(L)); }); // async callback with a pattern through any: LACKS // silent: a pattern: there is no row where no binding is read
await ta(async () => { const f = async (): Promise<R28> => anyv(json(G28)); return (await f()).id; }); // await, then a member: fits
await ta(async () => { const f = async (): Promise<R28> => anyv(json(L)); return (await f()).id; }); // await, then a member: LACKS
await ta(async () => { const get = async (): Promise<R29> => await Promise.resolve(json(G29)).then(r => r as Promise<any>); return (await get()).id; }); // await of fetch-like json: fits
await ta(async () => { const get = async (): Promise<R29> => await Promise.resolve(json(L)).then(r => r as Promise<any>); return (await get()).id; }); // await of fetch-like json: LACKS
await ta(async () => { const f = async (): Promise<R30> => anyv(json(G30)); const [a] = await Promise.all([f()]); return a.id; }); // Promise.all: fits
await ta(async () => { const f = async (): Promise<R30> => anyv(json(L)); const [a] = await Promise.all([f()]); return a.id; }); // Promise.all: LACKS
export {};
