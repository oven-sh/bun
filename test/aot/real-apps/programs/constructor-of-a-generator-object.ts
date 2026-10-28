function* numbers() {
  yield 1;
}
async function* later() {
  yield 1;
}
function kind(value: {} | null | undefined): string {
  switch (value?.constructor?.name) {
    case "String":
      return "a string";
    case "Array":
      return "an array";
    default:
      return "something else: " + typeof value?.constructor;
  }
}
console.log([kind("a"), kind([1]), kind(numbers()), kind(later()), kind(Object.create(null))].join("\n"));
