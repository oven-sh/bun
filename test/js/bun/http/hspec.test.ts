import { expect, test } from "bun:test";
import { runTests } from "./http-spec.ts";

test("https://github.com/uNetworking/h1spec tests pass", async () => {
  const passed = await runTests();
  expect(passed).toBe(true);
});
