// `const { id, ...rest } = row` makes an object with the layout of the names that are left. One such copy in the program takes nothing from the objects that plain literals with those names make: a read through the type has no test for an empty slot.
// IRT= 0 readRest GetSlotOrUndefined
// IRT= 0 readRest = TypeTest
interface Row { id: number; width: number; title: string }
interface Rest { width: number; title: string }
function makeRest(width: number, title: string): Rest { return { width, title }; }
function withoutId(row: Row) { const { id, ...rest } = row; return rest; }
function readRest(rest: Rest) { return rest.width + rest.title.length; }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
try { console.log(readRest(stranger)); } catch { console.log("threw"); }
const rests: Rest[] = [];
for (let i = 0; i < 300; i++) rests.push(makeRest(i, i & 1 ? "ab" : "abc"));
rests[0] = withoutId({ id: 1, width: 1, title: "abcd" });
let sum = 0;
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < 300; i++) sum += readRest(rests[i]);
}
console.log(sum, JSON.stringify(rests[0]), Object.keys(rests[0]).join());
