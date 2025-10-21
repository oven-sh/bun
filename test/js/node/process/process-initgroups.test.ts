import { expect, test } from "bun:test";
import { isWindows } from "harness";

if (!isWindows) {
  test("process.initgroups validates arguments", () => {
    // Missing arguments
    expect(() => {
      // @ts-expect-error
      process.initgroups();
    }).toThrow();

    expect(() => {
      // @ts-expect-error
      process.initgroups("user");
    }).toThrow();

    // Invalid argument types
    const invalidValues = [null, true, {}, [], () => {}];

    for (const val of invalidValues) {
      expect(() => {
        // @ts-expect-error
        process.initgroups(val, 1000);
      }).toThrow();

      expect(() => {
        // @ts-expect-error
        process.initgroups("user", val);
      }).toThrow();
    }
  });

  test("process.initgroups throws for non-existent user", () => {
    expect(() => {
      process.initgroups("fhqwhgadshgnsdhjsdbkhsdabkfabkveyb", 1000);
    }).toThrow(/User identifier does not exist/);
  });

  test("process.initgroups throws for non-existent group", () => {
    expect(() => {
      process.initgroups("root", "fhqwhgadshgnsdhjsdbkhsdabkfabkveyb");
    }).toThrow(/Group identifier does not exist/);
  });

  test("process.initgroups throws for invalid uid", () => {
    expect(() => {
      process.initgroups(9999999, 1000);
    }).toThrow(/User identifier does not exist/);
  });
} else {
  test("process.initgroups is undefined on Windows", () => {
    expect(process.initgroups).toBeUndefined();
  });
}
