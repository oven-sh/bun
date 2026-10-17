export function c(size) {
  console.error("[react-compiler] a cache of " + size);
  return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
}
