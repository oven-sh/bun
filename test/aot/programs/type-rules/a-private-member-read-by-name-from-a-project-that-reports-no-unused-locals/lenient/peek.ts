import type { Holder } from "../reports/holder";

export function peek(holder: Holder): number {
  return holder["hidden"];
}
