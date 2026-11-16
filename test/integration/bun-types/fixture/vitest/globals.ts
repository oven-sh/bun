import type { Mock } from "vitest";

declare module "vitest" {
  interface Matchers<R, T> {
    toBeWithin(floor: number, ceiling: number): R;
  }
}

beforeAll(() => {});
afterAll(() => {});
beforeEach(({ task }) => void task.name);
afterEach(() => {});
aroundEach(async run => {
  await run();
});
aroundAll(async run => {
  await run();
});

describe("globals", () => {
  suite("nested", () => {});
  test("test", ({ expect: bound }) => {
    const mock: Mock<() => number> = vi.fn(() => 1);
    expect(mock()).toBe(1);
    bound(1).toBeWithin(0, 2);
    expect(1).toBeWithin(0, 2);
    expectTypeOf(mock()).toBeNumber();
    assertType<number>(mock());
    onTestFinished(() => {});
    onTestFailed(() => {});
    vitest.clearAllMocks();
  });
  it("it", () => {});
});
