function ask(run: () => string): string {
  return run();
}
function kindOf(x: string): string {
  return ask(() => {
    if (typeof x === "number") return "a number";
    return "something else";
  });
}
const values: string[] = ["honest"];
const wide: unknown[] = values;
wide.push(7);
console.log(kindOf(values[0]));
console.log(kindOf(values[1]));
export {};
