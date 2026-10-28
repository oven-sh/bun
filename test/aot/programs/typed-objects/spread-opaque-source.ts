// Spread of a value of a written record type, which any object may be: a record of the type, a record of another type, a record with an undeclared property, a frozen record, a plain object, an object with its own prototype, an array, null and undefined.
// CALLS+ rename CloneObjectAndExtend
// CALLS- rename TryCopyRecordAsAt
type Shape = { name: string; sides: number; label?: string };
type Other = { extra: number[]; sides: number; name: string };
function rename(shape: Shape, name: string): Shape { return { ...shape, name }; }
function resize(shape: Shape, sides: number): Shape { return { ...shape, sides }; }
function copy(shape: Shape): Shape { return { ...shape }; }
const renamers: ((shape: Shape, name: string) => Shape)[] = [rename];
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
    for (const made of [renamers[0](shape, "n" + round), resizers[0](shape, round), copy(shape)])
      console.log(JSON.stringify(made), Object.keys(made).join(), Object.getPrototypeOf(made) === Object.prototype, made !== shape, Object.isFrozen(made));
  }
  for (const nothing of [undefined, null] as unknown as Shape[])
    console.log(JSON.stringify(rename(nothing, "n")), JSON.stringify(resize(nothing, 1)), JSON.stringify(copy(nothing)));
}
let total = 0;
for (let round = 0; round < 40000; round++) {
  const shape = held[round % held.length] as Shape;
  total += rename(shape, "x").name.length + resize(shape, round).sides + copy(shape).sides;
}
console.log(total);
