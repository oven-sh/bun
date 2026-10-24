// `{ ...x, key: value }` whose copy is a plain object, in typed and in generic code: one call clones and stores, as in untyped code, and plans room for the added properties.
// CALLS+ wide CloneObjectAndExtendWithNumber
// CALLS- wide PutBy
// CALLS+ named CloneObjectAndExtend
// CALLS- named PutBy
// CALLS+ both CloneObjectAndExtend
// CALLS- both PutBy
interface R { a: number; b: string }
function wide<T extends object>(r: T, g: number): T & { g: number } { return { ...r, g }; }
function named<T extends object>(r: T, name: string): T & { name: string } { return { ...r, name }; }
function both<T extends object>(r: T, g: number, name: string): T & { g: number; name: string } { return { ...r, name, g }; }
const wideners: (<T extends object>(r: T, g: number) => T & { g: number })[] = [wide];
const namers: (<T extends object>(r: T, name: string) => T & { name: string })[] = [named];
const doers: (<T extends object>(r: T, g: number, name: string) => T & { g: number; name: string })[] = [both];
let reads = 0;
const sources: object[] = [
  { a: 1, b: "x" } as R,
  JSON.parse('{"a":2,"b":"parsed"}'),
  JSON.parse('{"g":3,"name":"has both","z":1}'),
  JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"h":7,"i":8,"j":9}'),
  { get g() { return ++reads; }, name: "getter" },
  Object.freeze({ g: 4, name: "frozen" }),
  Object.assign(Object.create({ inherited: 1 }), { own: 1 }),
  [1, 2],
  {},
];
for (let round = 0; round < 3; round++) {
  for (const source of sources) {
    for (const made of [wideners[0]!(source, round + 0.5), wideners[0]!(source, round), wideners[0]!(source, NaN), wideners[0]!(source, -0), namers[0]!(source, "n" + round), doers[0]!(source, round, "b" + round)])
      console.log(JSON.stringify(made), Object.keys(made).join(), Object.is((made as { g?: number }).g, -0), Object.getPrototypeOf(made) === Object.prototype, made !== source, Object.isFrozen(made));
  }
}
console.log(reads);
let total = 0;
for (let i = 0; i < 30000; i++) {
  const source = sources[i % 4]!;
  total += wideners[0]!(source, i).g + namers[0]!(source, "xy").name.length + doers[0]!(source, 1, "z").name.length;
}
console.log(total);
