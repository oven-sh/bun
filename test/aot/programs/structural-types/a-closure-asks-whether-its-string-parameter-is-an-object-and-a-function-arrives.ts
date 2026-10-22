function ask(run: () => boolean): boolean {
  return run();
}
function isAnObject(x: string): boolean {
  return ask(() => typeof x === "object");
}
const values: string[] = ["honest"];
const wide: unknown[] = values;
wide.push(() => 1);
console.log(isAnObject(values[0]));
console.log(isAnObject(values[1]));
export {};
