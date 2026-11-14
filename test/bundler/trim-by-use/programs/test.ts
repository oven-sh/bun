import { expect, mock, spyOn, jest } from "bun:test";

expect(1 + 1).toBe(2);
expect({ a: [1, { b: 2 }], c: new Map([[1, 2]]) }).toEqual({ a: [1, { b: 2 }], c: new Map([[1, 2]]) });
expect("the matchers").toMatch(/match/);
expect(() => {
  throw new RangeError("out");
}).toThrow("out");
expect({ a: 1, b: "x" }).toMatchObject({ a: expect.any(Number) });
try {
  expect({ a: 1, list: [1, 2, 3] }).toEqual({ a: 2, list: [1, 2, 4] });
} catch (error) {
  console.log(Bun.stripANSI((error as Error).message));
}
const double = mock((value: number) => value * 2);
console.log(double(21), double.mock.calls.length);
expect(double).toHaveBeenCalledWith(21);
const target = { greet: (name: string) => `hello ${name}` };
const spy = spyOn(target, "greet").mockReturnValue("mocked");
console.log(target.greet("x"), spy.mock.calls[0]![0]);
jest.setSystemTime(new Date("2020-01-02T03:04:05Z"));
console.log(new Date().toISOString());
jest.setSystemTime();
console.log(new Date().getFullYear() > 2020);
