// Bun is in unknown hands and may have been written to. What `await import("bun")` answers is handed to a function, and only that function names the member.
console.log(Reflect.set(Bun, "color", 1, {}));
function take(bun) {
  return bun.peek(Promise.resolve(6));
}
console.log(take(await import("bun")));
