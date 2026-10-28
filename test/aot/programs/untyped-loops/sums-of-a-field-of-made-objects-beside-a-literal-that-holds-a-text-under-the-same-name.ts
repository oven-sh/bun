// Loops add up a field of objects that a function has made, and another literal holds a text under the same name. The sums stay small or pass 32 bits, alone or beside a counter.
const named = { kept: "a" };
console.log(named.kept);
function createKept(kept: number) {
  return { label: 1, kept };
}
const few: any[] = [];
for (let i = 0; i < 3; i++) few.push(createKept(i));
let sum = 0;
for (const each of few) sum += each.kept;
console.log(sum);

const weighed = { mass: "b" };
console.log(weighed.mass);
function createMass(mass: number) {
  return { mass, next: 1 };
}
function addLargeNumbers() {
  const list: any[] = [];
  for (let i = 0; i < 10; i++) list.push(createMass(i * 100000000));
  let sum = 0;
  let count = 0;
  for (const each of list) {
    sum -= each.mass;
    count += 2;
  }
  console.log(sum, count);
}
addLargeNumbers();
addLargeNumbers();
