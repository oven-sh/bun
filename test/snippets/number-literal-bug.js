// test that we don't call functions on number literals
export function test() {
  const precision = 10;
  try {
    parseFloat((0.0).toPrecision(precision) + "1");
  } catch (exception) {
    throw new Error("Test Failed", exception);
  }

  testDone(import.meta.url);
}
