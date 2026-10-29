// How many modules need a function wrapper under each variant?
import { rng } from "./gen.mjs";
import { emitProto2 } from "./plan-linker.mjs";
function layered(seed, N, k, where) {
  const r = rng(seed);
  const mods = Array.from({ length: N }, (_, i) => ({ id: "m" + i, imports: [], body: [{ t: "log" }] }));
  for (let i = 1; i < N; i++) mods[r.int(Math.max(0, i - 40), i - 1)].imports.push(i);
  for (let i = 0; i < N; i++) {
    const extra = r.int(0, 3);
    for (let e = 0; e < extra; e++) {
      const j = r.int(i + 1, Math.min(N - 1, i + 60));
      if (j > i && j < N && !mods[i].imports.includes(j)) mods[i].imports.push(j);
    }
  }
  const picks = new Set();
  while (picks.size < k)
    picks.add(
      where === "deep"
        ? r.int(Math.floor(N * 0.8), N - 1)
        : where === "shallow"
          ? r.int(1, Math.floor(N * 0.1))
          : r.int(1, N - 1),
    );
  for (const i of picks) mods[i].body.push({ t: "await0" }, { t: "log" });
  return { seed, profile: "dag", n: N, mods };
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log("N=300 modules, 40 graphs each".padEnd(34), "tainted", "exact-wrappers", "failfast-wrappers");
for (const where of ["shallow", "any", "deep"])
  for (const k of [1, 2, 4]) {
    const T = [],
      E = [],
      R = [];
    for (let s = 1; s <= 40; s++) {
      const g = layered(s, 300, k, where);
      const a = {},
        b = {};
      emitProto2(g, { stats: a });
      emitProto2(g, { stats: b, relaxed: true });
      T.push(a.tainted);
      E.push(a.wrappers);
      R.push(b.wrappers);
    }
    console.log(
      `${k} TLA module(s), ${where}`.padEnd(34),
      avg(T).padStart(7),
      avg(E).padStart(14),
      avg(R).padStart(17),
    );
  }
