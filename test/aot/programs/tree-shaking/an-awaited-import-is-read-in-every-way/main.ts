// import() of a literal path: the result is awaited and read by name, taken apart in a pattern, read in a then callback, in the pattern of a then callback, under a computed name, and kept as a promise.
const lib = await import("./lib");
console.log(lib.byName());

const { byPattern, default: byDefault } = await import("./lib");
console.log(byPattern(), byDefault());

console.log(await import("./lib").then(module => module.inThen()));
console.log(await import("./lib").then(({ inThenPattern }) => inThenPattern()));
console.log((await import("./lib") as any)["by" + "Computed"]());
console.log((await import("./lib")).afterParentheses());

const promise = import("./other");
async function later() {
  return (await promise).kept();
}
console.log(await later());
console.log((await Promise.all([import("./third")]))[0].inAll());
