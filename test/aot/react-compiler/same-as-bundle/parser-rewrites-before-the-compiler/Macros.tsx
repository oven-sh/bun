import { next } from "./counter";
import { limit } from "./limit" with { type: "macro" };

const outside = limit();

export function Expanded({ a }: { a: number }) {
  "use memo";
  return limit() > 2 ? [a, limit(), outside] : [a, next()];
}
