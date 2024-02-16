// Flags: --expose-internals
import { describe, test } from "bun:test";
import assert from "node:assert";
import { URL, parse } from "node:url";

describe("internal/url", () => {
  test.skip("isURL", () => {
    const { isURL } = require("internal/url");

    assert.strictEqual(isURL("https://www.nodejs.org"), true);
    assert.strictEqual(isURL(new URL("https://www.nodejs.org")), true);
    assert.strictEqual(isURL(parse("https://www.nodejs.org")), false);
    assert.strictEqual(
      isURL({
        href: "https://www.nodejs.org",
        protocol: "https:",
        path: "/",
      }),
      false,
    );
  });
});
