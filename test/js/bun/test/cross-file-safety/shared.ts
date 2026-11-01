import { expect, type Matchers } from "bun:test";

let expectValue: Matchers<number> | undefined = undefined;

export function getExpectValue() {
  return (expectValue ??= expect(25));
}
