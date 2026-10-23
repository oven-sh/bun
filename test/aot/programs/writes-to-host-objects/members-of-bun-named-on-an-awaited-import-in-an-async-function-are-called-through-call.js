// Bun is in unknown hands and may have been written to. An async function names a member only on `await import("bun")` and calls it through call.
Reflect.set(Bun, "color", 1, {});
async function later() {
  const bun = await import("bun");
  return bun.peek.call(undefined, 1);
}
console.log(String(await later()));
