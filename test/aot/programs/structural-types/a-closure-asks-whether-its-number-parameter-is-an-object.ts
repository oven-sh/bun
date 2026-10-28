function ask(run: () => boolean): string {
  return String(run());
}
function take(value: number): string {
  return "is an object " + ask(() => typeof value === "object") + ", is a number " + ask(() => typeof value === "number");
}
const list: number[] = [1];
const wide: unknown[] = list;
wide.push({});
console.log(take(list[0]));
console.log(take(list[1]));
