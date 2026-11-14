// This file binds `Infinity` and `NaN`. A number that is not finite is a number in the compiler's output, and reads neither.
const Infinity = "the binding named Infinity";
const NaN = "the binding named NaN";

type Props = { a: number };

export function Folded({ a }: Props) {
  "use memo";
  const max = 1 / 0;
  const zero = 0;
  const none = zero / 0;
  return [a, String(max), String(-max), String(none), a < max, Infinity, NaN];
}

// Nothing to fold: the source spells the number.
export function Spelled({ a }: Props) {
  "use memo";
  return [a, String(1e999), String(-1e999), a > -1e999, Infinity, NaN];
}
