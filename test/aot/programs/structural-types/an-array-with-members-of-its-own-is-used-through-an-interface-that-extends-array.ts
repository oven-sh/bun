// An array that a cast gave a `pos` and an `end` is used through interfaces that extend Array and ReadonlyArray, through an intersection, and as a plain `{ pos, end }`: elements, length, loops, spread and methods work as on any array, and its own members are read and stored by name.
interface TextRange { pos: number; end: number }
interface NodeArray<T> extends ReadonlyArray<T>, TextRange { hasTrailingComma: boolean; transformFlags?: number }
interface MutableNodeArray<T> extends Array<T>, TextRange { hasTrailingComma: boolean; transformFlags?: number }
interface ModifiersArray extends NodeArray<string> { isModifiers: boolean }
type Ranged<T> = T[] & TextRange;
interface Pair extends Array<number> { 0: number; 1: number; label: string }
function create<T>(elements: readonly T[], pos: number): NodeArray<T> {
  const array = elements.slice() as MutableNodeArray<T>;
  array.pos = pos; array.end = pos + elements.length; array.hasTrailingComma = false;
  return array;
}
function width(range: TextRange): number { return range.end - range.pos; }
function widthOf<T extends TextRange>(range: T): number { return range.end - range.pos; }
function sum(list: NodeArray<number>): number {
  let n = 0;
  for (const x of list) n += x;
  for (let i = 0; i < list.length; i++) n += list[i];
  n += [...list, 1].length;
  n += Math.max(...list);
  n += list.indexOf(2) + (list.includes(3) ? 1 : 0);
  n += list.transformFlags ?? 7;
  return n + (list.hasTrailingComma ? 100 : 0);
}
function split(list: NodeArray<number>): number { const [first, second] = list; return first + second; }
function doubled(list: NodeArray<number>): number { return list.map(x => x * 2).reduce((a, b) => a + b, 0) + list.filter(x => x > 1).length + list.slice(1).length + list.concat([1]).length; }
function modifiers(list: ModifiersArray): string { return list.join("+") + list.pos + list.isModifiers; }
function ranged(list: Ranged<number>): number { list.push(list.pos); return list.length + list.end + list[0]; }
function pair(p: Pair): string { return p.label + (p[0] + p[1]) + p.length; }
function keys(list: NodeArray<number>): string { return Object.keys(list).join() + JSON.stringify(list) + ("pos" in list) + Array.isArray(list); }
function grow(list: MutableNodeArray<number>): number { list.push(9); list.end++; list.transformFlags = 4; list[0] = 5; list.length = 3; return list.end + list.length; }
function maybe(list: NodeArray<number> | undefined): number { return list ? list.pos + list.length : -1; }
function either(value: NodeArray<number> | TextRange): number { return Array.isArray(value) ? value.length : value.pos; }
let total = 0, text = "";
for (let i = 0; i < 100; i++) {
  const list = create([i, 2, 3], i);
  total += sum(list) + split(list) + doubled(list) + width(list) + widthOf(list) + maybe(list) + maybe(undefined) + either(list) + either({ pos: 4, end: 5 });
  total += width({ pos: 1, end: 3 }) + widthOf({ pos: 1, end: 4 });
  const m = create(["a", "b"], 1) as ModifiersArray; (m as any).isModifiers = true;
  text = modifiers(m);
  const r = [1, 2] as Ranged<number>; r.pos = 3; r.end = 4;
  total += ranged(r);
  const p = [1, 2] as Pair; p.label = "p";
  text += pair(p) + keys(list);
  total += grow(list as MutableNodeArray<number>);
}
console.log(total, text);
