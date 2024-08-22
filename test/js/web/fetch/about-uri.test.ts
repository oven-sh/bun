"use strict";

import { describe, test, expect } from "bun:test";

describe("fetching about: uris", () => {
  test("about:blank", async () => {
    expect(fetch("about:blank")).rejects.pass();
  });

  test("All other about: urls should return an error", async () => {
    try {
      await fetch("about:config");
      expect.unreachable("fetching about:config should fail");
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});
