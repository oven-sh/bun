(globalThis.ran ??= []).push("values");
export let one = 1;
export function bump() {
  return ++one;
}
