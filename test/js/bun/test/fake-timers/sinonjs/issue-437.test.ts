// https://github.com/sinonjs/fake-timers/blob/main/test/issue-437-test.js

import { afterEach, describe, expect, test, vi } from "bun:test";

afterEach(() => vi.useRealTimers());

describe("issue #437", () => {
  test("should save methods of subclass instance", () => {
    vi.useFakeTimers();

    class DateTime extends Date {
      bar = "bar";

      foo() {
        return "Lorem ipsum";
      }
    }

    const dateTime = new DateTime();

    // this would throw an error before issue #437 was fixed
    expect(dateTime.foo()).toBe("Lorem ipsum");
    expect(dateTime.bar).toBe("bar");
  });
});
