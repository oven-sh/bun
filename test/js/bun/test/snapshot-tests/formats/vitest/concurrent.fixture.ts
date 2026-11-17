// @ts-nocheck
import { describe, test, expect } from "vitest";

const tick = () => new Promise<void>(r => setTimeout(r, 1));

describe("concurrent", () => {
  test.concurrent("first", async ({ expect }) => {
    expect("first a").toMatchSnapshot();
    await tick();
    await tick();
    expect("first b").toMatchSnapshot();
  });
  test.concurrent("second", async ({ expect }) => {
    expect("second a").toMatchSnapshot();
    await tick();
    expect("second b").toMatchSnapshot("hinted");
    expect(() => {
      throw new Error("concurrent error");
    }).toThrowErrorMatchingSnapshot();
  });
  test.concurrent("third", async ctx => {
    await tick();
    ctx.expect({ third: true }).toMatchSnapshot();
    ctx.expect(ctx.expect.getState().currentTestName).toMatchSnapshot();
  });
  describe.concurrent("block", () => {
    test("a", async ({ expect }) => {
      await tick();
      expect("block a").toMatchSnapshot();
    });
    test("b", async ({ expect }) => {
      expect("block b").toMatchSnapshot();
    });
  });
});

test("ctx.expect in a plain test", ({ expect: e }) => {
  e("plain").toMatchSnapshot();
  expect("global").toMatchSnapshot();
});
