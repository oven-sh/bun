const math: any = Math;
console.log(
  math.sumPrecise([1e20, 0.1, -1e20]),
  math.sumPrecise([]),
  math.sumPrecise([0.1, 0.2, 0.3]),
  math.sumPrecise(new Set([1, 2, 3])),
  math.sumPrecise([Infinity, 1]),
  math.sumPrecise([1e308, 1e308, -1e308]),
);
try {
  math.sumPrecise(["1"]);
} catch (error) {
  console.log((error as Error).name);
}
