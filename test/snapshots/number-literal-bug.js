export function test() {
  const precision = 10;
  try {
    parseFloat(0 .toPrecision(precision) + "1");
  } catch (exception) {
    throw new Error("Test Failed", exception);
  }
  testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/number-literal-bug.js.map
