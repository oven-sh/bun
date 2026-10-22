function ask(run: () => boolean): string {
  return String(run());
}
function take(value: number): string {
  return "is an object " + ask(() => typeof value === "object");
}
const list: number[] = [];
const wide: unknown[] = list;
wide.push({});
console.log(take(list[0]));
