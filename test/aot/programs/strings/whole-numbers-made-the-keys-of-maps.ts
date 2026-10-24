// Whole numbers, most of them held as doubles, are made the keys of a Map on four roads: by a helper and in place, from a double and from an int32.
// Each road has 5,000 numbers of its own and asks for their texts 80,000 | 40,000 | 20,000 | 10,000 times. whole-numbers-made-keys-avoid-runtime.test.ts counts what that asks of the run time.
class Thing {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}
function make(first: number): Thing[] {
  const list: Thing[] = [];
  let next = first + 0.5;
  for (let i = 0; i < 5000; i++) {
    list.push(new Thing(next - 0.5));
    next += 1;
  }
  return list;
}
function textOfDouble(thing: Thing): string {
  return "" + thing.id;
}
function textOfInteger(thing: Thing): string {
  return "" + (thing.id | 0);
}
function helperWithDouble(list: Thing[], rounds: number): number {
  const map = new Map<string, number>();
  for (const thing of list) map.set(textOfDouble(thing), thing.id);
  let sum = 0;
  for (let r = 1; r < rounds; r++) for (const thing of list) sum += map.get(textOfDouble(thing))!;
  return sum;
}
function helperWithInteger(list: Thing[], rounds: number): number {
  const map = new Map<string, number>();
  for (const thing of list) map.set(textOfInteger(thing), thing.id);
  let sum = 0;
  for (let r = 1; r < rounds; r++) for (const thing of list) sum += map.get(textOfInteger(thing))!;
  return sum;
}
function inPlaceWithDouble(list: Thing[], rounds: number): number {
  const map = new Map<string, number>();
  for (const thing of list) map.set("" + thing.id, thing.id);
  let sum = 0;
  for (let r = 1; r < rounds; r++) for (const thing of list) sum += map.get("" + thing.id)!;
  return sum;
}
function inPlaceWithInteger(list: Thing[], rounds: number): number {
  const map = new Map<string, number>();
  for (const thing of list) map.set("" + (thing.id | 0), thing.id);
  let sum = 0;
  for (let r = 1; r < rounds; r++) for (const thing of list) sum += map.get("" + (thing.id | 0))!;
  return sum;
}
console.log(helperWithDouble(make(2000), 16), helperWithInteger(make(12000), 8), inPlaceWithDouble(make(22000), 4), inPlaceWithInteger(make(32000), 2));
