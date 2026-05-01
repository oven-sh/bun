export function test() {
  console.assert(global === globalThis);
  return testDone(import.meta.url);
}
