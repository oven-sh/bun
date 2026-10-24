const list: (null | undefined)[] = [null, undefined];
const wide: unknown[] = list;
wide.push(0);

function text(value: null | undefined): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return "neither, a number: " + (typeof value === "number") + ", equal to null: " + (value == null);
}
function loose(value: null | undefined): string {
  return value == null ? "nothing" : "something";
}
function orElse(value: null | undefined): string {
  return String(value ?? "default");
}

console.log(text(list[0]), text(list[1]), loose(list[0]), orElse(list[1]));
console.log(loose(list[2]));
console.log(orElse(list[2]));
console.log(text(list[2]));
