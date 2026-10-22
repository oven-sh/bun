const empty: never[] = [];
const wide: number[] = empty;
wide.push(5);

function first(list: never[]): string {
  return "undefined: " + (list[0] === undefined);
}
function count(list: never[]): number {
  let seen = 0;
  for (const item of list) seen += item === undefined ? 100 : 1;
  return seen;
}

console.log(empty.length);
console.log(count(empty));
console.log(String(empty[0]));
console.log(typeof empty[0]);
console.log(first(empty));
