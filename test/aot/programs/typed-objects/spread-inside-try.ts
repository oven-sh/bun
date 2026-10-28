// `{ ...p }` inside `try`, returned as or stored into a written record type: the copy is made as a record of that type, and it has the keys, the order and the values that plain Bun gives it, also for a source with an extra property, a frozen source and a copy that a throw follows.
// IRT= 1 copy  = CloneAs 
interface Point { x: number; y: number; name: string; note?: string; late?: string }
function make(i: number): Point { return i % 2 ? { x: i, y: i + 1, name: "p", note: "n" } : { x: i, y: i + 1, name: "q" }; }
function copy(p: Point): Point { try { return { ...p }; } catch { return p; } }
function copyAndSet(p: Point, x: number): Point { try { return { ...p, x, late: "l" }; } catch { return p; } }
function copyOrThrow(p: Point | null, fails: boolean): Point | string {
  try {
    const made: Point = { ...(p as Point), y: 0 };
    if (fails) throw new Error("thrown");
    return made;
  } catch (error) {
    return (error as Error).message;
  }
}
const makers: ((i: number) => Point)[] = [make];
const copiers: ((p: Point) => Point)[] = [copy];
const setters: ((p: Point, x: number) => Point)[] = [copyAndSet];
let total = 0;
for (let i = 0; i < 2000; i++) {
  const p = makers[0]!(i);
  const first = copiers[0]!(p);
  const second = setters[0]!(p, -i);
  total += first.x + first.y + first.name.length + (first.note?.length ?? 0) + second.x + second.y + (second.late?.length ?? 0) + (first === p ? 1000000 : 0) + Object.keys(first).length + Object.keys(second).length;
}
console.log(total);
const marked = makers[0]!(1);
(marked as unknown as Record<string, number>).mark = 7;
console.log(JSON.stringify(copiers[0]!(marked)), JSON.stringify(setters[0]!(marked, 9)), Object.keys(setters[0]!(makers[0]!(2), 3)).join());
console.log(JSON.stringify(copyOrThrow(makers[0]!(3), false)), JSON.stringify(copyOrThrow(makers[0]!(3), true)));
const frozen = Object.freeze(makers[0]!(5));
console.log(JSON.stringify(copiers[0]!(frozen)), Object.isFrozen(copiers[0]!(frozen)));
