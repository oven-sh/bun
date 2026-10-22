// A declared type is read through whatever fits it: a literal of the type, a literal with more names, a class instance, an instance of a subclass and what a constructor function makes all arrive at `TextRange`, none of them by a conversion that names both types.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface TextRange {
  pos: number;
  end: number;
}
interface Node {
  readonly kind: number;
  readonly pos: number;
  readonly end: number;
}
function NodeObject(this: Mutable<Node>, kind: number, pos: number, end: number) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
}
class Token {
  kind = 7;
  constructor(
    public end: number,
    public pos: number,
  ) {}
}
class Comment extends Token {
  text = "note";
}
const width = (range: TextRange): number => range.end - range.pos;
const move = (range: TextRange, by: number): void => {
  range.pos += by;
  range.end += by;
};
const kindOf = (node: Node): number => node.kind;

const makers: (() => unknown)[] = [
  (): TextRange => ({ pos: 1, end: 4 }),
  () => ({ text: "wide", end: 9, pos: 2 }),
  () => new Token(30, 10),
  () => new Comment(8, 5),
  () => new (NodeObject as any)(3, 100, 250),
];

let total = 0;
for (let round = 0; round < 3; round++) {
  for (const make of makers) {
    const range = make() as TextRange;
    move(range, round);
    const measured = width(range);
    console.log(round, measured, range.pos, range.end, Object.keys(range).join());
    total += measured;
  }
}
console.log(total);
console.log(kindOf(new (NodeObject as any)(11, 0, 0)), kindOf(new Token(1, 0)), kindOf(new Comment(1, 0)));
