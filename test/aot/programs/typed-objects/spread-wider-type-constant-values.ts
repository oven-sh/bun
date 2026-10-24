// Spread into a wider type where the extra members are string constants, written before and after the spread. The names are only needed on the slow path; the constant values are stored into the fresh copy.
type Shape = { name: string; sides: number; label?: string };
type Tagged = { kind: string; name: string; sides: number; label?: string; note: string };
function tagAfter(shape: Shape): Tagged { return { ...shape, kind: "after", note: "n" }; }
function tagBefore(shape: Shape): Tagged { return { kind: "before", note: "name", ...shape }; }
function tagAround(shape: Shape): Tagged { return { kind: "kind", ...shape, note: "note" }; }
const taggers: ((shape: Shape) => Tagged)[] = [tagAfter, tagBefore, tagAround];
const plain: Shape = { name: "plain", sides: 3 };
const labeled: Shape = { name: "labeled", sides: 4, label: "l" };
const backwards: Shape = { label: "b", sides: 5, name: "backwards" };
const flagged: Shape = { name: "flagged", sides: 6 };
(flagged as Shape & { extra?: number }).extra = 1;
const shapes = [plain, labeled, backwards, flagged];
for (let round = 0; round < 3; round++) {
  for (const tag of taggers) {
    for (const shape of shapes) {
      const tagged = tag(shape);
      console.log(Object.keys(tagged).join(), JSON.stringify(tagged), tagged.kind.length + tagged.note.length);
    }
  }
}
let total = 0;
for (let round = 0; round < 60000; round++) {
  const tag = taggers[round % 3];
  const shape = shapes[round & 3];
  if (tag === undefined || shape === undefined) continue;
  const tagged = tag(shape);
  total += tagged.kind.length + tagged.note.length + tagged.sides + (tagged.label?.length ?? 0);
}
console.log(total);
