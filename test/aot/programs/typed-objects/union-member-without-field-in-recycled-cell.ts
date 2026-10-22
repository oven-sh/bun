// Only one member of the union has `payload`. A read through the union may load the slot without a shape test, so an object of the other member must read as undefined even when its cell held a payload before the collection.
// The functions are called through a table, so that nothing is inlined and no allocation is removed.
interface WithPayload { first: number; payload: object }
interface WithoutPayload { first: number }
type Either = WithPayload | WithoutPayload;

function withPayload(i: number): WithPayload { return { first: i, payload: { i } } }
function withoutPayload(i: number): WithoutPayload { return { first: i } }
function payloadOf(value: Either): unknown { return (value as any).payload }
function fill(count: number, create: (i: number) => Either): Either[] {
  const list: Either[] = [];
  for (let i = 0; i < count; i++) list.push(create(i));
  return list;
}
function countPayloads(list: Either[]): number {
  let count = 0;
  for (const value of list) if (F.payloadOf(value) !== undefined) count++;
  return count;
}
function countOwnPayloads(list: Either[]): number {
  let count = 0;
  for (const value of list) if ("payload" in value) count++;
  return count;
}
function sumOfFirst(list: Either[]): number {
  let sum = 0;
  for (const value of list) sum += value.first;
  return sum;
}
const F = { withPayload, withoutPayload, payloadOf, fill, countPayloads, countOwnPayloads, sumOfFirst };

for (let round = 0; round < 4; round++) {
  let list = F.fill(4000, F.withPayload);
  console.log(round, "with", F.countPayloads(list), F.countOwnPayloads(list), F.sumOfFirst(list));
  list = [];
  Bun.gc(true);
  list = F.fill(4000, F.withoutPayload);
  console.log(round, "without", F.countPayloads(list), F.countOwnPayloads(list), F.sumOfFirst(list), Object.keys(list[3999]).join());
  list = [];
  Bun.gc(true);
}
