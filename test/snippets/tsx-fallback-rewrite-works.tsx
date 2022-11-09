// @ts-nocheck
// This looks like it does nothing
// But if you import /tsx-fallback-rewrite-works.js, it should resolve the import to /tsx-fallback-rewrite-works.tsx
export function test() {
  return testDone(import.meta.url);
}
