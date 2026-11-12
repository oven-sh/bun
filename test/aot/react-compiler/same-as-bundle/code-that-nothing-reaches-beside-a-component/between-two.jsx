export function useFirst(a) {
  "use memo";
  return [a, "first"];
}
const neverCalled = () => 1;
export function useSecond(a) {
  "use memo";
  return [a, "second"];
}
function neverCalledEither() {
  return 2;
}
