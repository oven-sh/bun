// `{ ...r, key: value }` where r has a written record type, which any object may be.
// A record of the layout is copied inline. Anything else (null, a record with an undeclared property, a plain object) takes one call, as in untyped code.
// CALLS+ withId CopyTypedObject
// CALLS+ withId CloneObjectAndExtendWithNumber
// CALLS+ withName CloneObjectAndExtend
// CALLS- withName CastInRegister|CloneObjectWithSubtypeCheck
// CALLS+ withBoth CloneObjectAndExtend
// CALLS- withBoth CastInRegister|CloneObjectWithSubtypeCheck
// SIZE< withId 100
// SIZE< withName 112
// SIZE< withBoth 150
interface Row { id: number; name: string; tags: string[]; next: Row | null }
interface Looks { id: number; name: string; tags: string[]; next: Looks | null }

const parsedRow: Row = JSON.parse(['{"id":1,"name":"a",', '"tags":["x"],"next":null}'].join(""));

function withId(r: Looks, id: number): Looks { return { ...r, id }; }
function withName(r: Looks, name: string): Looks { return { ...r, name }; }
function withBoth(r: Looks, id: number, name: string): Looks { return { ...r, name, id }; }
function read(r: Looks): string { return r.id + " " + r.name + " " + r.tags.length + " " + (r.next === null ? "end" : r.next === undefined ? "none" : r.next.name); }

const byId: ((r: Looks, id: number) => Looks)[] = [withId];
const byName: ((r: Looks, name: string) => Looks)[] = [withName];
const byBoth: ((r: Looks, id: number, name: string) => Looks)[] = [withBoth];
const readers: ((r: Looks) => string)[] = [read];

const record: Looks = { id: 1, name: "record", tags: [], next: null };
const nested: Looks = { id: 2, name: "nested", tags: ["t"], next: record };
const marked: Looks = { id: 3, name: "marked", tags: [], next: null };
(marked as Looks & { mark?: number }).mark = 1;
const frozen: Looks = Object.freeze({ id: 4, name: "frozen", tags: [], next: null });
const sources: Looks[] = [record, nested, marked, frozen];
for (let round = 0; round < 3; round++) {
  for (const r of sources) {
    for (const made of [byId[0]!(r, round + 0.5), byId[0]!(r, round), byId[0]!(r, NaN), byId[0]!(r, -0), byName[0]!(r, "n" + round), byBoth[0]!(r, round, "b" + round)])
      console.log(readers[0]!(made), JSON.stringify(made), Object.keys(made).join(), Object.is(made.id, -0), Object.getPrototypeOf(made) === Object.prototype, made !== r, Object.isFrozen(made));
  }
  for (const nothing of [undefined, null] as unknown as Looks[])
    console.log(JSON.stringify(byId[0]!(nothing, 1)), JSON.stringify(byName[0]!(nothing, "n")), JSON.stringify(byBoth[0]!(nothing, 1, "n")));
}
console.log(parsedRow.id);
let total = 0;
for (let round = 0; round < 30000; round++) {
  const r = sources[round % sources.length]!;
  total += byId[0]!(r, round).id + byName[0]!(r, "x").name.length + byBoth[0]!(r, 1, "yy").name.length;
}
console.log(total);
