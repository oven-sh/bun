import { expect } from "bun:test";

let expectValue = undefined;

export function getExpectValue() {
  return (expectValue ??= expect(25));
}
