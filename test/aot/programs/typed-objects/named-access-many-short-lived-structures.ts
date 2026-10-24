// One site reads, stores and asks `in` by a fixed name on objects of hundreds of shapes that come and go, with collections of the young in between: what is remembered for a shape that has died is never taken for a new one at its address.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Any = Record<string, any>;
function build(seed: number): Any {
  const o: Any = {};
  const width = 1 + (seed % 11);
  for (let i = 0; i < width; i++) o["f" + ((seed * 3 + i) % 17)] = seed + i;
  if (seed % 3 === 0) o.wanted = seed;
  if (seed % 5 === 0) o.other = "o" + seed;
  return o;
}
const proto = { inherited: 11, get computed() { return 13; } };
function derived(seed: number): Any {
  const o: Any = Object.create(proto);
  for (let i = 0; i < seed % 6; i++) o["g" + ((seed + i) % 9)] = i;
  return o;
}
function read(o: Any): number {
  return (o.wanted ?? 1) + (o.inherited ?? 2) + (o.computed ?? 3) + (typeof o.other === "string" ? o.other.length : 0);
}
function store(o: Any, v: number): void {
  o.wanted = v;
  o.added = v + 1;
}
function has(o: Any): number {
  return ("wanted" in o ? 1 : 0) + ("inherited" in o ? 2 : 0) + ("nothing" in o ? 4 : 0);
}
const old: Any[] = [];
for (let i = 0; i < 60; i++) old.push(i % 2 ? build(i) : derived(i));
let total = 0;
const lines: string[] = [];
for (let round = 0; round < 30; round++) {
  for (let i = 0; i < 500; i++) {
    const o = i % 3 ? build(round * 41 + i) : derived(round * 7 + i);
    total += read(o) + has(o);
    store(o, i);
    total += read(o) + has(o);
  }
  for (const o of old) total += read(o) + has(o);
  collect(round % 8 === 7);
  for (const o of old) total += read(o) + has(o);
  if (round === 12) (proto as Any).wanted = 1000;
  if (round === 20) delete (proto as Any).wanted;
  if (round % 2) collect(false);
  lines.push(round + " " + total);
}
console.log(lines.join("\n"));
