// An object literal of untyped code lists all its members in the allocation, whatever their values are, so a read of one of its fields has no test for an empty slot and none for `undefined`.
// IR= 0 read GetSlotOrUndefined
// IR= 0 read IsSlotFilled
// IR= 0 read = TypeTest
// IR= 0 readBoth GetSlotOrUndefined
// IR= 0 readBoth = TypeTest
function make(x) { return { kind: "a", value: x }; }
function read(o) { return o.kind.length + o.value; }
function pair(a, b) { return { a, b }; }
function pairWithConstant(a) { return { a, b: 2 }; }
function readBoth(o) { return o.a + o.b; }

const made = [];
for (let i = 0; i < 300; i++) made.push(make(i));
const pairs = [];
for (let i = 0; i < 300; i++) pairs.push(i & 1 ? pair(i, i + 1) : pairWithConstant(i));
let sum = 0;
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < 300; i++) sum += read(made[i]) + readBoth(pairs[i]);
}
console.log(sum, JSON.stringify(made[7]), JSON.stringify(pairs[7]), JSON.stringify(pairs[8]), Object.keys(make(1)).join());

function makeLoose(x) { return { tag: "a", held: x, last: x ? x : null }; }
const loose = makeLoose(1);
loose.held = "text";
loose.extra = true;
delete loose.tag;
console.log(JSON.stringify(loose), "tag" in loose, Object.keys(loose).join(), JSON.stringify(makeLoose(0)));
