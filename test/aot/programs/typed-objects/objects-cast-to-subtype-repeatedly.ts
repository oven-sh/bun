// An object made as a base type and cast to a subtype afterwards stays the same object and takes stores to the subtype's optional fields, whichever order its own fields were created in, however often the same cast has run before, and whether or not it holds extra properties.
interface Base { id: number; flags: number; label?: string; owner?: Base }
interface Wide extends Base { extra?: string; more?: number; list?: number[] }
interface Wider extends Wide { last?: boolean }
interface Other extends Base { other?: string }

function plain(id: number): Base { return { id, flags: 1 }; }
function labelled(id: number): Base { const made: Base = { id, flags: 2 }; made.label = "l" + id; return made; }
function owned(id: number): Base { const made: Base = { id, flags: 3 }; made.owner = made; made.label = "o"; return made; }
function labelledLate(id: number): Base { const made: Base = { id, flags: 4 }; made.owner = undefined; return made; }
function withExtra(id: number): Base { const made: Base = { id, flags: 5 }; (made as any).stray = id; return made; }

function widen(base: Base): Wide { const wide = base as Wide; wide.more = base.id * 2; return wide; }
function widenMore(wide: Wide): Wider { const wider = wide as Wider; wider.last = true; return wider; }
function toOther(base: Base): Other { const other = base as Other; other.other = "other"; return other; }
function show(value: Base): string { return JSON.stringify(value, (key, held) => (key === "owner" && held ? "owner" : held)) + " " + Object.keys(value).join(); }

const makers = [plain, labelled, owned, labelledLate, withExtra];
let sum = 0;
for (let round = 0; round < 300; round++) {
  for (const make of makers) {
    const base = make(round);
    const same = widen(base);
    if (same !== base) throw new Error("another object");
    sum += same.more! + (same.extra === undefined ? 1 : 0) + ("list" in same ? 100 : 0);
    const again = widen(same);
    const wider = widenMore(again);
    sum += wider.last ? 1 : 0;
    if (round % 100 === 0) console.log(show(wider));
  }
  const other = toOther(makers[round % makers.length](round));
  sum += other.other!.length;
  if (round % 150 === 0) console.log(show(other));
}
console.log(sum);
try {
  console.log(show(toOther(widen(plain(1)))));
} catch (error) {
  console.log((error as Error).name);
}
