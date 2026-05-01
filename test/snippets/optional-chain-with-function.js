export function test() {
  try {
    const multipleSecondaryValues = undefined;
    const ratings = ["123"];

    var bar = multipleSecondaryValues?.map(value => false);
    bar = bar?.multipleSecondaryValues?.map(value => false);
    bar = bar?.bar?.multipleSecondaryValues?.map(value => false);
    bar = {}?.bar?.multipleSecondaryValues?.map(value => false);
  } catch (e) {
    throw e;
  }

  return testDone(import.meta.url);
}
