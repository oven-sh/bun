var ε = 1e-6,
  ε2 = ε * ε,
  π = Math.PI,
  τ = 2 * π,
  τε = τ - ε,
  halfπ = π / 2,
  d3_radians = π / 180,
  d3_degrees = 180 / π;

export { d3_radians };

export function test() {
  console.assert(ε === 1e-6);
  return testDone(import.meta.url);
}
