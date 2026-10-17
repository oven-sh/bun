// `{ ...record, more: value }` of a type with more fields than the record's: the keys come in the order of the source's, then the new ones; what the source has under a new name is replaced where it stands.
// CALLS- widen CloneObjectAndExtend
// CALLS- widenTwice CloneObjectAndExtend
type Shape = { name: string; next: Shape | undefined; sides: number; label?: string };
type Wider = Shape & { weight: number };
type Widest = Shape & { weight: number; owner: string; tags?: string[] };
function widen(shape: Shape, weight: number): Wider { return { ...shape, weight }; }
function widenTwice(shape: Shape, weight: number, owner: string): Widest { return { ...shape, weight, owner }; }
function widenWithConstants(shape: Shape): Widest { return { ...shape, weight: 1.5, owner: "nobody" }; }
function widenAgain(shape: Wider, owner: string): Widest { return { ...shape, owner }; }
const wideners: ((shape: Shape, weight: number, owner: string) => Shape)[] = [widen, widenTwice, widenWithConstants];
const triangle: Shape = { name: "triangle", next: undefined, sides: 3 };
const square: Shape = { name: "square", next: triangle, sides: 4, label: "four" };
const late: Shape = { sides: 5, name: "late", next: square };
late.label = "five";
const heavy: Wider = { weight: 9, name: "heavy", next: undefined, sides: 6 };
const marked: Shape = { name: "marked", next: undefined, sides: 7 };
(marked as Shape & { extra?: number }).extra = 1;
const frozen: Shape = Object.freeze({ name: "frozen", next: undefined, sides: 8 });
for (let round = 0; round < 3; round++) {
  for (const widener of wideners) {
    for (const shape of [triangle, square, late, heavy, marked, frozen]) {
      const made = widener(shape, round + 0.5, "owner" + round);
      console.log(JSON.stringify(made), Object.keys(made).join(), Object.isFrozen(made), made.next === shape.next);
    }
  }
  const again = widenAgain(widen(square, round), "again");
  console.log(JSON.stringify(again), Object.keys(again).join());
}
let total = 0;
for (let round = 0; round < 50000; round++) {
  const made = widenTwice(round & 1 ? triangle : round & 2 ? square : late, round, "o");
  total += made.weight + made.sides + made.owner.length + (made.label?.length ?? 0);
}
console.log(total);
