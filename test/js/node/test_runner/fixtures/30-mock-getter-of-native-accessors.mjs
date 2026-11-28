import assert from "node:assert";
import { test } from "node:test";

// mock.getter() defines the getter on the object with the attributes of the accessor that the object inherits, and
// restoreAll() defines that accessor over it. Neither works on an accessor that is not configurable.
for (const [name, make, key] of [
  ["TextDecoder", () => new TextDecoder(), "encoding"],
  ["Blob", () => new Blob(["ab"]), "size"],
  ["Request", () => new Request("http://example.com/"), "url"],
  ["Response", () => new Response("body"), "ok"],
]) {
  test(`mock.getter() on ${key} of a ${name}, then restoreAll()`, t => {
    const object = make();
    const real = object[key];
    t.mock.getter(object, key, () => "mocked");
    assert.strictEqual(object[key], "mocked");
    t.mock.restoreAll();
    assert.deepStrictEqual(object[key], real);
  });
}
