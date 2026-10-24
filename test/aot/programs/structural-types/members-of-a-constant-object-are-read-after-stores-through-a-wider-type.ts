const limits = { low: 1, high: 10, name: "range", open: false } as const;
const wide: { low: number; high: number; name: string; open: boolean } = limits;

function span(): number {
  return limits.high - limits.low;
}
function inside(n: number): boolean {
  return n >= limits.low && n <= limits.high;
}

console.log(span(), inside(5), inside(50), limits.name, limits.open);
wide.low = 40.5;
wide.high = 60;
wide.name = "moved";
wide.open = true;
console.log(limits.low);
console.log(limits.high);
console.log(span());
console.log(inside(5));
console.log(inside(50));
console.log(limits.name);
console.log(limits.name === "range");
console.log(limits.open ? "open" : "closed");
console.log(limits.low === 1, limits.high === 10);
