import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/20664
// Decorated properties without initializers were being removed from the class body
// during legacy decorator lowering, causing Object.keys(instance) to return [].

function Expose() {
  return function (_target: any, _propertyKey: string) {};
}

test("decorated properties without initializers should remain as own properties", () => {
  class Schema {
    @Expose()
    id: string;

    @Expose()
    name: string;

    @Expose()
    date: Date;
  }

  const instance = new Schema();
  const keys = Object.keys(instance);
  expect(keys).toEqual(["id", "name", "date"]);
  expect(instance.id).toBe(undefined);
  expect(instance.name).toBe(undefined);
  expect(instance.date).toBe(undefined);
  expect("id" in instance).toBe(true);
  expect("name" in instance).toBe(true);
  expect("date" in instance).toBe(true);
});

test("decorated properties with initializers should preserve values", () => {
  class Schema {
    @Expose()
    id: string = "abc";

    @Expose()
    name: string = "test";
  }

  const instance = new Schema();
  expect(Object.keys(instance)).toEqual(["id", "name"]);
  expect(instance.id).toBe("abc");
  expect(instance.name).toBe("test");
});

test("mix of decorated properties with and without initializers", () => {
  class Schema {
    @Expose()
    id: string;

    @Expose()
    name: string = "default";

    @Expose()
    date: Date;
  }

  const instance = new Schema();
  // Uninitialized fields (id, date) are kept as class field declarations and
  // created during field initialization. Initialized fields (name) are moved
  // to constructor assignments. Field declarations run before the constructor,
  // so uninitialized fields appear first in property order.
  expect(Object.keys(instance)).toEqual(["id", "date", "name"]);
  expect(instance.id).toBe(undefined);
  expect(instance.name).toBe("default");
  expect(instance.date).toBe(undefined);
});
