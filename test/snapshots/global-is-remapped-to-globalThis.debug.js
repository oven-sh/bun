export function test() {
  console.assert(globalThis === globalThis);
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/global-is-remapped-to-globalThis.js.map
