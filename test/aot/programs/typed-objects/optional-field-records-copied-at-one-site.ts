// A copy into another layout gets its keys in the order of the source's keys. One site is handed records whose keys differ, turn by turn: each copy lists its own keys, and the site asks a table for the order it does not remember.
// CALLS+ widen LookupCopyKeyOrder
// CALLS+ widenInFront LookupCopyKeyOrder
// CALLS+ withoutName LookupCopyKeyOrder
type Shape = { name: string; sides: number; label?: string; color?: string; hidden?: boolean };
type Wider = { name: string; sides: number; label?: string; color?: string; hidden?: boolean; weight: number };
type Nameless = { sides: number; label?: string; color?: string; hidden?: boolean };
function widen(shape: Shape, weight: number): Wider { return { ...shape, weight }; }
function widenInFront(shape: Shape, weight: number): Wider { return { weight, ...shape }; }
function withoutName(shape: Shape): Nameless { const { name, ...rest } = shape; return rest; }
const plain: Shape = { name: "plain", sides: 3 };
const labeled: Shape = { name: "labeled", sides: 4, label: "l" };
const colored: Shape = { name: "colored", sides: 5, color: "c" };
const both: Shape = { name: "both", sides: 6, color: "c", label: "l" };
const backwards: Shape = { hidden: true, label: "l", sides: 7, name: "backwards" };
const late: Shape = { name: "late", sides: 8 };
late.hidden = false;
late.color = "k";
const shapes = [plain, labeled, colored, both, backwards, late];
const wideners: ((shape: Shape, weight: number) => Wider)[] = [widen, widenInFront];
const strippers: ((shape: Shape) => Nameless)[] = [withoutName];
for (let round = 0; round < 4; round++) {
  for (const shape of shapes) {
    const wider = wideners[0](shape, round);
    const front = wideners[1](shape, round);
    const rest = strippers[0](shape);
    console.log(Object.keys(wider).join(), Object.keys(front).join(), Object.keys(rest).join(), JSON.stringify(wider), JSON.stringify(front), JSON.stringify(rest));
  }
}
let total = 0;
let keys = 0;
for (let round = 0; round < 60000; round++) {
  const shape = shapes[round % shapes.length];
  if (shape === undefined) continue;
  const wider = widen(shape, round);
  const front = widenInFront(shape, round);
  const rest = withoutName(shape);
  total += wider.weight + front.sides + rest.sides + (wider.label?.length ?? 0) + (front.color?.length ?? 0) + (rest.hidden === undefined ? 0 : 1);
  if (!(round % 4999)) keys += Object.keys(wider).length * 100 + Object.keys(front).length * 10 + Object.keys(rest).length;
}
console.log(total, keys);
