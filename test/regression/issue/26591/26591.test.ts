import { test, expect, mock } from "bun:test";

test("mock.module works with process.getBuiltinModule", async () => {
  const mockOS = {
    platform: () => "mocked",
  };

  mock.module("node:os", () => mockOS);

  const os = process.getBuiltinModule("node:os");
  expect(os.platform()).toBe("mocked");
});
