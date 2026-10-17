// Inside `try` every operation that may throw ends its block, so `{ ...p }` and the cast behind it stand in two blocks. The copy was then made as a plain object and converted by the runtime at the cast. It is predicted to have the type it is cast to, so it is copied as a record.
// IRT= 1 copy ~undefined\|null\|Point\.\d+ = CallBuiltin CloneObject#
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
