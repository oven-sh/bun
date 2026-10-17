interface Rare { zqxcity: string; zqxzip?: string; zqxcount: number; zqxinner: { zqxdeep: string } }
class Kept { zqxfield = "f"; zqxmethod() { return "m"; } get zqxgot() { return "g"; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : v)); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function at(x: any, k: any): any { return x[k]; }
function many(x: any, k: any): unknown[] { const out: unknown[] = []; for (let i = 0; i < 40; i++) out.push(x[k]); return [out[0], out[39], out.every(v => v === out[0])]; }
const make = (): Rare => ({ zqxcity: "c", zqxcount: 1.5, zqxinner: { zqxdeep: "d" } });
const glue = (a: string, b: string) => a + b;
show("a constant that names a field", () => many(make(), "zqxcity"));
show("a constant that names a number field", () => many(make(), "zqxcount"));
show("a constant that names an absent optional field", () => many(make(), "zqxzip"));
show("the same after it is set, and after it is deleted", () => { const x = make(); const a = many(x, "zqxzip"); x.zqxzip = "z"; const b = many(x, "zqxzip"); delete x.zqxzip; return [a, b, many(x, "zqxzip")]; });
show("a constant that names nothing", () => many(make(), "zqxnothing"));
show("then an extra of that name", () => { const x = make(); const a = many(x, "zqxlater"); hide(x).zqxlater = 1; return [a, many(x, "zqxlater"), many(make(), "zqxlater")]; });
show("then the prototype has that name", () => { const proto = JSON.parse("{}"); const under = () => Object.setPrototypeOf(hide(make()), proto); const a = many(under(), "zqxabove"); proto.zqxabove = "up"; const b = many(under(), "zqxabove"); delete proto.zqxabove; return [a, b, many(under(), "zqxabove")]; });
show("a string made at run time", () => many(make(), glue("zqx", "city")));
show("a rope each time", () => { const x = make(); const out: unknown[] = []; for (let i = 0; i < 40; i++) out.push(at(x, glue("zqxc", "ount"))); return [out[0], out.every(v => v === 1.5)]; });
show("along a path", () => { let o: any = make(); for (const k of ["zqxinner", "zqxdeep"]) o = at(o, k); return o; });
show("an instance: a field, a method, a getter", () => { const x = new Kept(); return [many(x, "zqxfield"), typeof at(x, "zqxmethod"), many(x, "zqxgot")]; });
show("index-like and odd keys", () => ["0", "1.5", "-0", "", " ", "zqx city", "01", "4294967295", "4294967294"].map(k => many(make(), k)[0]));
show("not strings", () => [0, 1.5, null, undefined, true, Symbol.iterator, { toString() { return "zqxcity"; } }].map(k => at(make(), k)));
show("typed and plain in turn, one site", () => [make(), JSON.parse('{"zqxturn":1}'), make(), { zqxturn: 2 }, make()].map(x => at(x, "zqxturn")));
show("one key, two layouts", () => { const other: { zqxcity: number } = { zqxcity: 7 }; return [make(), other, make(), other].map(x => at(x, "zqxcity")); });
show("a long key", () => many(make(), "zqx".repeat(1000))[0]);
