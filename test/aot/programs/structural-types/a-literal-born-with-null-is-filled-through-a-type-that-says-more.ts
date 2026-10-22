// An object literal whose own type says `null` is written through a declared type that allows a string as well; another literal of the same name holds a boolean.
type Color = "red" | "blue";
type Holder = { color: Color | null };
type HolderWithAge = { color: Color | null; age?: number };

function pick(): Color {
  return Math.random() < 2 ? "red" : "blue";
}
function makeEmpty() {
  return { color: null };
}
function makeFlag(on: boolean) {
  return { color: on };
}
function fill(holder: Holder): Color {
  if (holder.color === null) holder.color = pick();
  return holder.color;
}
function fillAndAge(holder: HolderWithAge): string {
  if (holder.color === null) holder.color = pick();
  holder.age = (holder.age ?? 0) + 1;
  return holder.color + " " + holder.age;
}

const first = makeEmpty();
const second = makeEmpty();
console.log(makeFlag(true).color, fill(first), first.color);
console.log(fillAndAge(second), fillAndAge(second), JSON.stringify(second), Object.keys(second).join());
for (let round = 0; round < 3; round++) {
  const holder = makeEmpty();
  console.log(round, holder.color, fill(holder), JSON.stringify(holder));
}
