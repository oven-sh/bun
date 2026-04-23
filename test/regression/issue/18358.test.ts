import { describe, expect, it, mock } from "bun:test";

// Register mock BEFORE the static import (which gets hoisted by ESM).
// The mock.module() call should be detected during transpilation and
// a placeholder virtual module registered so that the static import
// doesn't fail during module linking.
mock.module("./18358-fixture-missing-export.ts", () => ({
  myExportedFunction: (fn: any) => ({
    getClient: fn,
    query: () => ({ data: { test: "test" }, loading: false, error: undefined }),
  }),
}));

import { myExportedFunction } from "./18358-fixture-missing-export.ts";

describe("issue #18358", () => {
  it("mock.module should intercept module loading before ESM link phase", () => {
    expect(typeof myExportedFunction).toBe("function");
    const result = myExportedFunction(() => "client");
    expect(result.getClient()).toBe("client");
    expect(result.query()).toEqual({
      data: { test: "test" },
      loading: false,
      error: undefined,
    });
  });
});
