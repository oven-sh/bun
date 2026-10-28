// Spread of a value of a written record type, which any object may be, followed by a store to a number field. Every copy that the program makes stores that field, so it stays a plain number, and off the usual path the copy and the store are one call that takes the number unboxed.
// CALLS+ resize CloneObjectAndExtendWithNumber
type Shape = { name: string; sides: number; label?: string };
type Other = { extra: number[]; sides: number; name: string };
function resize(shape: Shape, sides: number): Shape { return { ...shape, sides }; }
const resizers: ((shape: Shape, sides: number) => Shape)[] = [resize];
const record: Shape = { name: "record", sides: 3 };
const labeled: Shape = { name: "labeled", sides: 4, label: "l" };
const other: Other = { extra: [1], sides: 5, name: "other" };
const marked: Shape = { name: "marked", sides: 10 };
(marked as Shape & { tag?: string }).tag = "t";
const frozen: Shape = Object.freeze({ name: "frozen", sides: 11 });
const held: object[] = [record, labeled, other, marked, frozen];
held.push(Object.assign(Object.create(Object.prototype), { name: "assigned", sides: 6 }));
held.push(Object.assign(Object.create({ inherited: 1 }), { name: "inheriting", sides: 7, label: "own" }));
held.push(JSON.parse('{"sides":8,"name":"parsed","more":true}'));
held.push(Object.assign([10, 20], { name: "list", sides: 9 }));
for (let round = 0; round < 3; round++) {
  for (const object of held) {
    const shape = object as Shape;
    for (const made of [resizers[0](shape, round)])
      console.log(JSON.stringify(made), Object.keys(made).join(), Object.getPrototypeOf(made) === Object.prototype, made !== shape, Object.isFrozen(made));
  }
  for (const nothing of [undefined, null] as unknown as Shape[])
    console.log(JSON.stringify(resize(nothing, 1)));
}
let total = 0;
for (let round = 0; round < 40000; round++) {
  const shape = held[round % held.length] as Shape;
  total += resize(shape, round).sides;
}
console.log(total);
