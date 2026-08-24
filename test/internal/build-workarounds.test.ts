import { expect, test } from "bun:test";

import type { Config } from "../../scripts/build/config.ts";
import { workarounds } from "../../scripts/build/workarounds.ts";

test("the Windows libuv close patch is registered until the dependency pin changes", () => {
  const workaround = workarounds.find(entry => entry.id === "libuv-win-close-crt-assert");

  expect(workaround).toBeDefined();
  if (workaround === undefined) throw new Error("missing libuv close workaround");

  expect(workaround.applies({ windows: true } as Config)).toBe(true);
  expect(workaround.applies({ windows: false } as Config)).toBe(false);
  expect(workaround.expectedToBeFixed({ windows: true } as Config)).toBe(false);
  expect(workaround.cleanup).toContain("patches/libuv/win-close-disable-crt-assert.patch");
});
