function two(first: number, second: number): number {
  return first + second;
}

const values: { length: number }[] = [{ length: 1 }, two];

function isFunction(item: { length: number }): boolean {
  return typeof item === "function";
}

for (const value of values) console.log("zzresult", isFunction(value), typeof value);
