// @ts-nocheck
// This looks like it does nothing
// But if you import /ts-fallback-rewrite-works.js, it should resolve the import to /ts-fallback-rewrite-works.ts
export function test() {
  return testDone(import.meta.url);
}
