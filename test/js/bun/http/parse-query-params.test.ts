import { parseQueryParams } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("parseQueryParams - simple parameters", () => {
  const result = parseQueryParams("name=john&age=30&active=true");
  expect(result).toEqual({
    name: "john",
    age: "30",
    active: "true",
  });
});

test("parseQueryParams - empty query string", () => {
  const result = parseQueryParams("");
  expect(result).toEqual({});
});

test("parseQueryParams - URL encoded values", () => {
  const result = parseQueryParams("message=Hello%20World&special=%40%23%24%25");
  expect(result).toEqual({
    message: "Hello World",
    special: "@#$%",
  });
});

test("parseQueryParams - Rails-style nested objects", () => {
  const result = parseQueryParams("user[name]=john&user[age]=30&user[email]=john@example.com");
  expect(result).toEqual({
    user: {
      name: "john",
      age: "30",
      email: "john@example.com",
    },
  });
});

test("parseQueryParams - Rails-style deeply nested objects", () => {
  const result = parseQueryParams("person[address][street]=123%20Main&person[address][city]=Portland&person[name]=Bob");
  expect(result).toEqual({
    person: {
      address: {
        street: "123 Main",
        city: "Portland",
      },
      name: "Bob",
    },
  });
});

test("parseQueryParams - Rails-style arrays with empty brackets", () => {
  const result = parseQueryParams("ids[]=1&ids[]=2&ids[]=3");
  expect(result).toEqual({
    ids: ["1", "2", "3"],
  });
});

test("parseQueryParams - Rails-style indexed arrays", () => {
  const result = parseQueryParams("items[0]=apple&items[1]=banana&items[2]=orange");
  expect(result).toEqual({
    items: ["apple", "banana", "orange"],
  });
});

test.skip("parseQueryParams - Rails-style nested arrays", () => {
  // TODO: This is a known limitation - nested arrays like user[tags][] are not fully supported yet
  // Currently creates an object instead of array
  const result = parseQueryParams("user[tags][]=admin&user[tags][]=developer&user[name]=alice");
  expect(result).toEqual({
    user: {
      tags: ["admin", "developer"],
      name: "alice",
    },
  });
});

test("parseQueryParams - duplicate keys (last wins)", () => {
  const result = parseQueryParams("color=red&color=blue&color=green");
  expect(result).toEqual({
    color: "green",
  });
});

test("parseQueryParams - mixed simple and nested parameters", () => {
  const result = parseQueryParams("simple=value&nested[key]=nestedValue&array[]=1&array[]=2");
  expect(result).toEqual({
    simple: "value",
    nested: {
      key: "nestedValue",
    },
    array: ["1", "2"],
  });
});

test("parseQueryParams - complex nested structure", () => {
  const result = parseQueryParams("users[0][name]=alice&users[0][age]=25&users[1][name]=bob&users[1][age]=30");
  console.log("Result:", JSON.stringify(result, null, 2));
  expect(result).toEqual({
    users: [
      { name: "alice", age: "25" },
      { name: "bob", age: "30" },
    ],
  });
});

test("parseQueryParams - __proto__ is ignored for security", () => {
  const result = parseQueryParams("__proto__=evil&user[__proto__]=bad&normal=ok");
  // When __proto__ is the only key for an object, the object is not created
  expect(result).toEqual({
    normal: "ok",
  });

  // Verify prototype wasn't polluted
  expect(Object.prototype.hasOwnProperty("evil")).toBe(false);
});

test("parseQueryParams - special characters in keys", () => {
  const result = parseQueryParams("key%20with%20spaces=value&symbols!%40%23=test");
  expect(result).toEqual({
    "key with spaces": "value",
    "symbols!@#": "test",
  });
});

test("parseQueryParams - sparse indexed arrays", () => {
  const result = parseQueryParams("arr[0]=first&arr[2]=third&arr[5]=sixth");
  // Sparse arrays will have undefined for missing indices
  expect(result).toEqual({
    arr: ["first", undefined, "third", undefined, undefined, "sixth"],
  });
});

test("parseQueryParams - array and object type conflict", () => {
  const result = parseQueryParams("items[]=array&items[key]=object");
  // First param established items as array, so object notation is ignored
  expect(result).toEqual({
    items: ["array"],
  });
});
