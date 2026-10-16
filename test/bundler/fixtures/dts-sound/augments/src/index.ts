import type { Watched } from "./types";
export function watch<T>(value: T): Partial<Watched<T>> {
  return typeof Symbol.watched === "symbol" ? { [Symbol.watched]: () => value } : {};
}
