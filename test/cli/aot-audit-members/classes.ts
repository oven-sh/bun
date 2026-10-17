// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
class TopK { v = 0; constructor(r?: Uint8Array) { if (r) this.v = r.byteLength; } f(r: Uint8Array) { return r.byteLength; } set r(r: Uint8Array) { this.v = r.byteLength; } static g(r: Uint8Array) { return r.byteLength; } }
function topF(r: Uint8Array) { return r.byteLength; }
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
async function ta(f: () => Promise<unknown>) { at++; let said: string; try { const v = await f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { let s: unknown; (anyv([anyv(new Uint8Array(1)), anyv(new Uint8Array(1))]) as any[]).sort((a: Uint8Array, b: Uint8Array) => { s = a.byteLength + b.byteLength; return 0; }); return s; }); // sort of any[]: the class
t(() => { let s: unknown; (anyv([anyv(new ArrayBuffer(1)), anyv(new ArrayBuffer(1))]) as any[]).sort((a: Uint8Array, b: Uint8Array) => { s = a.byteLength + b.byteLength; return 0; }); return s; }); // sort of any[]: ANOTHER ENGINE CLASS
t(() => { let s: unknown; (anyv([anyv({ byteLength: 1 }), anyv({ byteLength: 1 })]) as any[]).sort((a: Uint8Array, b: Uint8Array) => { s = a.byteLength + b.byteLength; return 0; }); return s; }); // sort of any[]: PLAIN DATA
t(() => { return Array.from(anyv([anyv(new Uint8Array(1))]) as any[], (r: Uint8Array) => r.byteLength).join(); }); // Array.from with a callback: the class
t(() => { return Array.from(anyv([anyv(new ArrayBuffer(1))]) as any[], (r: Uint8Array) => r.byteLength).join(); }); // Array.from with a callback: ANOTHER ENGINE CLASS
t(() => { return Array.from(anyv([anyv({ byteLength: 1 })]) as any[], (r: Uint8Array) => r.byteLength).join(); }); // Array.from with a callback: PLAIN DATA
t(() => { let s: unknown; (anyv([anyv(new Uint8Array(1))]) as any[]).forEach((r: Uint8Array) => { s = r.byteLength; }); return s; }); // forEach of any[]: the class
t(() => { let s: unknown; (anyv([anyv(new ArrayBuffer(1))]) as any[]).forEach((r: Uint8Array) => { s = r.byteLength; }); return s; }); // forEach of any[]: ANOTHER ENGINE CLASS
t(() => { let s: unknown; (anyv([anyv({ byteLength: 1 })]) as any[]).forEach((r: Uint8Array) => { s = r.byteLength; }); return s; }); // forEach of any[]: PLAIN DATA
t(() => { const f = (r: Uint8Array) => r.byteLength; (globalThis as any)["zs" + "12"] = f; return (globalThis as any)["zs" + "12"](anyv(new Uint8Array(1))); }); // let out on the global object: the class
t(() => { const f = (r: Uint8Array) => r.byteLength; (globalThis as any)["zs" + "13"] = f; return (globalThis as any)["zs" + "13"](anyv(new ArrayBuffer(1))); }); // let out on the global object: ANOTHER ENGINE CLASS
t(() => { const f = (r: Uint8Array) => r.byteLength; (globalThis as any)["zs" + "14"] = f; return (globalThis as any)["zs" + "14"](anyv({ byteLength: 1 })); }); // let out on the global object: PLAIN DATA
t(() => { const f = (r: Uint8Array) => r.byteLength; const hold: any[] = [f]; return hold[0](anyv(new Uint8Array(1))); }); // let out in an any array: the class
t(() => { const f = (r: Uint8Array) => r.byteLength; const hold: any[] = [f]; return hold[0](anyv(new ArrayBuffer(1))); }); // let out in an any array: ANOTHER ENGINE CLASS
t(() => { const f = (r: Uint8Array) => r.byteLength; const hold: any[] = [f]; return hold[0](anyv({ byteLength: 1 })); }); // let out in an any array: PLAIN DATA
t(() => { const make = (): unknown => (r: Uint8Array) => r.byteLength; return (make() as any)(anyv(new Uint8Array(1))); }); // returned as unknown: the class
t(() => { const make = (): unknown => (r: Uint8Array) => r.byteLength; return (make() as any)(anyv(new ArrayBuffer(1))); }); // returned as unknown: ANOTHER ENGINE CLASS
t(() => { const make = (): unknown => (r: Uint8Array) => r.byteLength; return (make() as any)(anyv({ byteLength: 1 })); }); // returned as unknown: PLAIN DATA
t(() => { const o: any = { f: (r: Uint8Array) => r.byteLength }; return o.f(anyv(new Uint8Array(1))); }); // a member of an untyped literal: the class
t(() => { const o: any = { f: (r: Uint8Array) => r.byteLength }; return o.f(anyv(new ArrayBuffer(1))); }); // a member of an untyped literal: ANOTHER ENGINE CLASS
t(() => { const o: any = { f: (r: Uint8Array) => r.byteLength }; return o.f(anyv({ byteLength: 1 })); }); // a member of an untyped literal: PLAIN DATA
t(() => { const o: any = { f(r: Uint8Array) { return r.byteLength; } }; return o.f(anyv(new Uint8Array(1))); }); // a method of an untyped literal: the class
t(() => { const o: any = { f(r: Uint8Array) { return r.byteLength; } }; return o.f(anyv(new ArrayBuffer(1))); }); // a method of an untyped literal: ANOTHER ENGINE CLASS
t(() => { const o: any = { f(r: Uint8Array) { return r.byteLength; } }; return o.f(anyv({ byteLength: 1 })); }); // a method of an untyped literal: PLAIN DATA
t(() => { const api = { handle(r: Uint8Array) { return r.byteLength; } }; const u: unknown = api; return (u as any).handle(anyv(new Uint8Array(1))); }); // a method of a typed literal through any: the class
t(() => { const api = { handle(r: Uint8Array) { return r.byteLength; } }; const u: unknown = api; return (u as any).handle(anyv(new ArrayBuffer(1))); }); // a method of a typed literal through any: ANOTHER ENGINE CLASS
t(() => { const api = { handle(r: Uint8Array) { return r.byteLength; } }; const u: unknown = api; return (u as any).handle(anyv({ byteLength: 1 })); }); // a method of a typed literal through any: PLAIN DATA
t(() => { const call = (o: any, x: any) => o.data(x); return call({ data(r: Uint8Array) { return r.byteLength; } }, anyv(new Uint8Array(1))); }); // a method of a literal handed to a function that takes any: the class
t(() => { const call = (o: any, x: any) => o.data(x); return call({ data(r: Uint8Array) { return r.byteLength; } }, anyv(new ArrayBuffer(1))); }); // a method of a literal handed to a function that takes any: ANOTHER ENGINE CLASS
t(() => { const call = (o: any, x: any) => o.data(x); return call({ data(r: Uint8Array) { return r.byteLength; } }, anyv({ byteLength: 1 })); }); // a method of a literal handed to a function that takes any: PLAIN DATA
t(() => { const call = (g: any, x: any) => g(x); return call((r: Uint8Array) => r.byteLength, anyv(new Uint8Array(1))); }); // handed to a function that takes any: the class
t(() => { const call = (g: any, x: any) => g(x); return call((r: Uint8Array) => r.byteLength, anyv(new ArrayBuffer(1))); }); // handed to a function that takes any: ANOTHER ENGINE CLASS
t(() => { const call = (g: any, x: any) => g(x); return call((r: Uint8Array) => r.byteLength, anyv({ byteLength: 1 })); }); // handed to a function that takes any: PLAIN DATA
t(() => { const f = function (r: Uint8Array) { return r.byteLength; }; return Function.prototype.call.call(f, undefined, anyv(new Uint8Array(1))); }); // Function.prototype.call: the class
t(() => { const f = function (r: Uint8Array) { return r.byteLength; }; return Function.prototype.call.call(f, undefined, anyv(new ArrayBuffer(1))); }); // Function.prototype.call: ANOTHER ENGINE CLASS
t(() => { const f = function (r: Uint8Array) { return r.byteLength; }; return Function.prototype.call.call(f, undefined, anyv({ byteLength: 1 })); }); // Function.prototype.call: PLAIN DATA
t(() => { const f = function (r: Uint8Array) { return r.byteLength; }; const g: any = f.bind(undefined); return g(anyv(new Uint8Array(1))); }); // a bound function: the class
t(() => { const f = function (r: Uint8Array) { return r.byteLength; }; const g: any = f.bind(undefined); return g(anyv(new ArrayBuffer(1))); }); // a bound function: ANOTHER ENGINE CLASS
t(() => { const f = function (r: Uint8Array) { return r.byteLength; }; const g: any = f.bind(undefined); return g(anyv({ byteLength: 1 })); }); // a bound function: PLAIN DATA
t(() => { class S { f(r: Uint8Array) { return r.byteLength; } } const s: any = new S(); return s.f(anyv(new Uint8Array(1))); }); // a method of a local class through any: the class
t(() => { class S { f(r: Uint8Array) { return r.byteLength; } } const s: any = new S(); return s.f(anyv(new ArrayBuffer(1))); }); // a method of a local class through any: ANOTHER ENGINE CLASS
t(() => { class S { f(r: Uint8Array) { return r.byteLength; } } const s: any = new S(); return s.f(anyv({ byteLength: 1 })); }); // a method of a local class through any: PLAIN DATA
t(() => { return anyv(new TopK()).f(anyv(new Uint8Array(1))); }); // a method of a top-level class through any: the class
t(() => { return anyv(new TopK()).f(anyv(new ArrayBuffer(1))); }); // a method of a top-level class through any: ANOTHER ENGINE CLASS
t(() => { return anyv(new TopK()).f(anyv({ byteLength: 1 })); }); // a method of a top-level class through any: PLAIN DATA
t(() => { const s = anyv(new TopK()); s.r = anyv(new Uint8Array(1)); return s.v; }); // a setter of a top-level class through any: the class
t(() => { const s = anyv(new TopK()); s.r = anyv(new ArrayBuffer(1)); return s.v; }); // a setter of a top-level class through any: ANOTHER ENGINE CLASS
t(() => { const s = anyv(new TopK()); s.r = anyv({ byteLength: 1 }); return s.v; }); // a setter of a top-level class through any: PLAIN DATA
t(() => { return (anyv(TopK) as any).g(anyv(new Uint8Array(1))); }); // a static method through any: the class
t(() => { return (anyv(TopK) as any).g(anyv(new ArrayBuffer(1))); }); // a static method through any: ANOTHER ENGINE CLASS
t(() => { return (anyv(TopK) as any).g(anyv({ byteLength: 1 })); }); // a static method through any: PLAIN DATA
t(() => { const C: any = TopK; return new C(anyv(new Uint8Array(1))).v; }); // a constructor through any: the class
t(() => { const C: any = TopK; return new C(anyv(new ArrayBuffer(1))).v; }); // a constructor through any: ANOTHER ENGINE CLASS
t(() => { const C: any = TopK; return new C(anyv({ byteLength: 1 })).v; }); // a constructor through any: PLAIN DATA
t(() => { return (anyv(topF) as any)(anyv(new Uint8Array(1))); }); // a declared function through any: the class
t(() => { return (anyv(topF) as any)(anyv(new ArrayBuffer(1))); }); // a declared function through any: ANOTHER ENGINE CLASS
t(() => { return (anyv(topF) as any)(anyv({ byteLength: 1 })); }); // a declared function through any: PLAIN DATA
t(() => { return topF(anyv(new Uint8Array(1))); }); // a direct call with an any argument: the class
t(() => { return topF(anyv(new ArrayBuffer(1))); }); // a direct call with an any argument: ANOTHER ENGINE CLASS
t(() => { return topF(anyv({ byteLength: 1 })); }); // a direct call with an any argument: PLAIN DATA
await ta(async () => { return await new Promise(done => { setTimeout((r: Uint8Array) => done(r.byteLength), 0, anyv(new Uint8Array(1))); }); }); // setTimeout with an argument: the class
await ta(async () => { return await new Promise(done => { setTimeout((r: Uint8Array) => done(r.byteLength), 0, anyv(new ArrayBuffer(1))); }); }); // setTimeout with an argument: ANOTHER ENGINE CLASS
await ta(async () => { return await new Promise(done => { setTimeout((r: Uint8Array) => done(r.byteLength), 0, anyv({ byteLength: 1 })); }); }); // setTimeout with an argument: PLAIN DATA
await ta(async () => { function f(r: Uint8Array) { return r.byteLength; } return await Promise.resolve(anyv(new Uint8Array(1))).then(f); }); // then with a declared function: the class
await ta(async () => { function f(r: Uint8Array) { return r.byteLength; } return await Promise.resolve(anyv(new ArrayBuffer(1))).then(f); }); // then with a declared function: ANOTHER ENGINE CLASS
await ta(async () => { function f(r: Uint8Array) { return r.byteLength; } return await Promise.resolve(anyv({ byteLength: 1 })).then(f); }); // then with a declared function: PLAIN DATA
await ta(async () => { const f = async (r: Uint8Array) => r.byteLength; const g: any = f; return await g(anyv(new Uint8Array(1))); }); // an async arrow handed out: the class
await ta(async () => { const f = async (r: Uint8Array) => r.byteLength; const g: any = f; return await g(anyv(new ArrayBuffer(1))); }); // an async arrow handed out: ANOTHER ENGINE CLASS
await ta(async () => { const f = async (r: Uint8Array) => r.byteLength; const g: any = f; return await g(anyv({ byteLength: 1 })); }); // an async arrow handed out: PLAIN DATA
export {};
