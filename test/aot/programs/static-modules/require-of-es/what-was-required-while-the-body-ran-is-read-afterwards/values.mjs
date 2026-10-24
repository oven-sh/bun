import registry from "./registry.cjs";
export const zero = 0;
registry.emit();
export const one = 1;
export function bump() {
  return one + 1;
}
