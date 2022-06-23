var ε = 0.000001;
var ε2 = ε * ε;
var π = Math.PI;
var τ = 2 * π;
var τε = τ - ε;
var halfπ = π / 2;
var d3_radians = π / 180;
var d3_degrees = 180 / π;

export { d3_radians };
export function test() {
  console.assert(ε === 0.000001);
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/unicode-identifiers.js.map
