// What a generator with an inferred type yields, and what a promise of an async function with an inferred type resolves to, may be external data of another type.
const data = JSON.parse('{"t":"abc"}') as { t: number };
const lines: string[] = [];
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + (typeof v === "object" ? JSON.stringify(v) : String(v)); } catch (e) { r = "throws " + (e as Error).constructor.name; } lines.push(label + " ==> " + r); };
function* each() { yield 1; yield data.t; }
function* trusted() { yield 1; yield 2; }
const later = async () => data.t;
say("a spread of a generator", () => [...each()][1] + 1);
say("for of over a generator", () => { let r = ""; for (const v of each()) r += v + 1; return r; });
say("destructured from a generator", () => { const [, second] = each(); return second + 1; });
say("Array.from of a generator", () => Array.from(each())[1] + 1);
say("added up", () => { let n = 0; for (const v of each()) n += v; return n; });
say("a trusted generator stays exact", () => { let n = 0; for (const v of trusted()) n += v; return n + 1; });
const settled = await Promise.all([
  later().then(v => v + 1),
  later().then(v => { let n = 0; n += v; return n; }),
  later().then(async v => v + 1),
  (async () => (await later()) + 1)(),
]).then(all => all.map(v => typeof v + " " + String(v)), e => ["throws " + (e as Error).constructor.name]);
console.log(lines.concat(settled).join("\n"));
