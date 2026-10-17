// `as` around a tail call still converts the result for direct typed callers, exactly as it does when the call is not a tail call.
const untyped: any = {};
let bottom: any = 0;
function toNumber(n: number): number {
  if (n === 0) return untyped.give() as number;
  return untyped.toNumber(n - 1) as number;
}
function toText(n: number): string {
  if (n === 0) return untyped.give() as string;
  return untyped.toText(n - 1) as string;
}
Object.assign(untyped, { toNumber, toText, give: () => bottom });
const show = (value: unknown) => (typeof value === "symbol" || typeof value === "bigint" ? typeof value : `${typeof value} ${JSON.stringify(value)}`);
function numberAt(depth: number): string {
  const value = toNumber(depth);
  return show(value);
}
function textAt(depth: number): string {
  const value = toText(depth);
  return show(value);
}
for (const value of [1, 2.5, "5", "", true, null, undefined, {}, [7], 1n, Symbol.iterator]) {
  bottom = value;
  for (const depth of [0, 1, 3, 100000]) {
    for (const [name, call] of [["toNumber", numberAt], ["toText", textAt]] as [string, (depth: number) => string][]) {
      try {
        console.log(name, show(value), depth, "->", call(depth));
      } catch (error) {
        console.log(name, show(value), depth, "throws", (error as Error).constructor.name);
      }
    }
  }
}
