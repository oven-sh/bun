function readX(o: any) { return o.x; }
function readM(o: any) { return o.m; }
function hasX(o: any) { return "x" in o; }
function writeX(o: any, v: any) { o.x = v; }
let wrong = 0, checked = 0;
const expect = (got: unknown, want: unknown, what: string) => { checked++; if (got !== want && wrong++ < 5) console.log("WRONG " + what + ": " + String(got) + " instead of " + String(want)); };
let serial = 0;
for (let round = 0; round < 60; round++) {
  const protos = Array.from({ length: 8 }, (_, i) => (i % 2 ? { m: "m" + round + "_" + i } : Object.assign(Object.create({ m: "deep" + round + "_" + i }), { own: 1 })));
  let batch: any[] = [];
  for (let i = 0; i < 400; i++) {
    const o = Object.create(protos[i % protos.length]);
    const before = (i * 7 + round) % 9;
    for (let k = 0; k < before; k++) o["p" + serial++] = -1;
    const kind = (i + round) % 4;
    if (kind !== 3) o.x = "x" + round + "_" + i;
    o["q" + serial++] = -2;
    batch.push([o, kind !== 3 ? "x" + round + "_" + i : undefined, protos[i % protos.length].m]);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const [o, x, m] of batch) {
      expect(readX(o), x, "x");
      expect(readM(o), m, "m");
      expect(hasX(o), x !== undefined, "in");
    }
  }
  for (const [o, x] of batch) { writeX(o, "w" + round); expect(o.x, "w" + round, "stored"); expect(Object.keys(o).filter(k => k === "x").length, 1, "one x"); expect(Object.values(o).filter(v => v === -1 || v === -2).length, Object.keys(o).length - 1, "the rest is as it was"); }
  batch = [];
  if (round % 3 !== 2) Bun.gc(true); else { let junk: any[] = []; for (let i = 0; i < 200_000; i++) junk.push({ i }); junk = []; }
}
console.log(wrong ? "FAILED: " + wrong + " of " + checked : "ok: " + checked + " checked");
