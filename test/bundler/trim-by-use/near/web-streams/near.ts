console.log(
  "no stream",
  [1, 2, 3]
    .values()
    .map(x => x * 2)
    .toArray()
    .join(),
);
async function* generate() {
  yield 1;
  yield 2;
}
for await (const value of generate()) console.log(value);
console.log(await Promise.all([Promise.resolve(1)]), typeof queueMicrotask, new Uint8Array([1, 2]).length);
await new Promise(resolve => setTimeout(resolve, 1));
console.error("to stderr");
