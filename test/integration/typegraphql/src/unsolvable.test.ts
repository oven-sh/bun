import "reflect-metadata";
import { test, expect } from "bun:test" with { todo: "true" };
function Abc() {
  return (target: any, field: string) => {};
}

type Sample2<A, B, C> = A extends "1" ? B : C;
type Demo = Sample2<"2", string, number>;
class M {
  @Abc()
  myval: number;
  @Abc()
  myval2: Demo;
}
test("basic metadata works", () => {
  expect(Reflect.getMetadata("design:type", M.prototype, "myval")).toBe(Number);
});
test.todo("bun can't support complex metadata", () => {
  expect(Reflect.getMetadata("design:type", M.prototype, "myval2")).toBe(Number);
});
