// What the compiler's output names without a position of its own (the cache) is code of the hook, not of the statement that follows it.
export function useLabel(a) {
  "use memo";
  return [a, "kept"];
}
function neverCalled() {
  return 1;
}
