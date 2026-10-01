import { origin, counter, bump, makePoint, Vec, Vec3, NoCtor, OldStyle, plain } from "./shapes.ts";
import * as text from "./text.ts";
const clean = (e: any) => `${e?.constructor?.name}: ${e?.message} @ ${String(e?.stack).split("\n").slice(1, 4).map(l => l.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ")).join(" < ")}`;
export async function work(seed: number): Promise<string[]> {
  const out: string[] = [];
  out.push("bump " + [bump(seed), bump(1), counter].join());
  out.push("points " + JSON.stringify([origin, makePoint(seed, 2)]));
  let v: Vec = Vec.zero; for (let i = 0; i < 200; i++) v = v.plus(new Vec(i % 3, seed)); out.push("vec " + [v.x, v.y, v.len.toFixed(3)].join());
  const v3 = new Vec3(1, 2, seed).plus(v); out.push("vec3 " + [v3.x, v3.y, v3.z, v3 instanceof Vec, Object.keys(v3).join("")].join());
  out.push("noctor " + JSON.stringify(new NoCtor()) + " " + new (OldStyle as any)(seed).twice() + " " + JSON.stringify(new (plain as any)(seed)));
  out.push("tokens " + text.tokens("abc12 de f" + seed + " ghi").join(" "));
  text.sticky.lastIndex = 0; out.push("sticky " + [text.sticky.test("aaab"), text.sticky.lastIndex, text.sticky.test("aaab"), text.sticky.lastIndex].join());
  let r = ""; for (let i = 0; i < 50; i++) r = text.replaceAll("education" + i + seed); out.push("replace " + r);
  out.push("kind " + ["alpha", "beta", "gamma", "delta", "x" + seed].map(text.kind).join());
  out.push("tagged " + [text.tagged(seed), text.tagged(seed + 1)].join(" "));
  out.push("range " + [...text.range(5)].join() + " " + text.rest(seed, 1, 2, 3) + " " + text.spread({ a: seed, b: 2, c: 3 }));
  out.push("later " + await text.later(seed * 2)); const s: string[] = []; for await (const x of text.stream(3)) s.push(x); out.push("stream " + s.join());
  try { text.fail(2); } catch (e) { out.push("fail " + clean(e)); }
  try { text.tdz(); } catch (e) { out.push("tdz " + clean(e)); }
  try { (undefined as any)(); } catch (e: any) { out.push("call " + e.message); }
  const m = new Map<string, Vec>(); for (let i = 0; i < 100; i++) m.set("k" + (i % 7), new Vec(i, seed)); out.push("map " + [...m.keys()].join("") + m.get("k3")!.x);
  const garbage: unknown[] = []; for (let i = 0; i < 20000; i++) garbage.push({ i, s: "x" + i, v: new Vec(i, i) }); out.push("garbage " + garbage.length);
  out.push("fn " + [String(work).slice(0, 14), work.name, Vec.name, typeof text.tokens].join());
  return out;
}
