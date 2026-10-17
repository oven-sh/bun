import { Generator } from "./schema";
import type { Decoded } from "./types";
export { count, type Walk } from "./walk";
export const key = Symbol.for("key");
export const ids = new Generator();
export function decode(decoded: Decoded, input: unknown): string {
  return decoded.text.optional ? "" : decoded.text.decode(input) + String(decoded.symbol.decode(input));
}
