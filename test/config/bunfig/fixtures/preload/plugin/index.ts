import assert from "node:assert";
import foo from "./foo.yaml" with { type: "yaml" };
assert(foo);
assert.equal(typeof foo, "object");
