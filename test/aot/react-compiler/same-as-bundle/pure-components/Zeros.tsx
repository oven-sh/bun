// `0 === -0`, but a local that is `0` on one path and `-0` on another is not one constant. Each component reads its zero
// in a division: a memo block does not run again for a dependency of which only the sign changes.
type Props = { a: number };

export function ZeroOrMinusZero({ a }: Props) {
  "use memo";
  let zero: number;
  if (a > 1) zero = 0;
  else zero = -0;
  return [1 / zero > 0, String(1 / zero)];
}

export function ZeroFromATernary({ a }: Props) {
  "use memo";
  const zero = a > 1 ? -0 : 0;
  return [1 / zero > 0, String(1 / zero)];
}
