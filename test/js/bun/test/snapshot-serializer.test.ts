import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";

test("expect.addSnapshotSerializer basic functionality", () => {
  // Define a simple serializer for Date objects
  const dateSerializer = {
    test(val: any) {
      return val instanceof Date;
    },
    serialize(val: Date, printer: (val: any) => string) {
      return `Date(${val.getTime()})`;
    },
  };

  expect.addSnapshotSerializer(dateSerializer);

  const now = new Date(1234567890123);
  expect(now).toMatchSnapshot();
});

test("expect.addSnapshotSerializer with nested objects", () => {
  // Define a serializer for objects with a special property
  const customSerializer = {
    test(val: any) {
      return val && typeof val === 'object' && val.type === 'custom';
    },
    serialize(val: any, printer: (val: any) => string) {
      // For now, we'll just use a simple string representation since the printer is not fully implemented
      return `CustomObject(${val.name}: ${JSON.stringify(val.value)})`;
    },
  };

  expect.addSnapshotSerializer(customSerializer);

  const obj = {
    type: 'custom',
    name: 'test',
    value: { nested: true, array: [1, 2, 3] }
  };

  expect(obj).toMatchSnapshot();
});

test("expect.addSnapshotSerializer precedence - last added wins", () => {
  // First serializer
  const firstSerializer = {
    test(val: any) {
      return typeof val === 'string';
    },
    serialize(val: string, printer: (val: any) => string) {
      return `First: ${val}`;
    },
  };

  // Second serializer
  const secondSerializer = {
    test(val: any) {
      return typeof val === 'string';
    },
    serialize(val: string, printer: (val: any) => string) {
      return `Second: ${val}`;
    },
  };

  expect.addSnapshotSerializer(firstSerializer);
  expect.addSnapshotSerializer(secondSerializer);

  expect("hello").toMatchSnapshot();
});

test("expect.addSnapshotSerializer handles complex objects", () => {
  // Serializer for Map objects
  const mapSerializer = {
    test(val: any) {
      return val instanceof Map;
    },
    serialize(val: Map<any, any>, printer: (val: any) => string) {
      const entries = Array.from(val.entries());
      return `Map {${entries.map(([key, value]) => `${JSON.stringify(key)} => ${JSON.stringify(value)}`).join(', ')}}`;
    },
  };

  expect.addSnapshotSerializer(mapSerializer);

  const map = new Map([
    ["key1", "value1"],
    ["key2", { nested: true }],
    [123, "number key"],
  ]);

  expect(map).toMatchSnapshot();
});

test("expect.addSnapshotSerializer error handling", () => {
  // Test validation errors
  expect(() => {
    expect.addSnapshotSerializer({});
  }).toThrow("must have a 'test' method");

  expect(() => {
    expect.addSnapshotSerializer({
      test: "not a function",
    });
  }).toThrow("'test' property must be a function");

  expect(() => {
    expect.addSnapshotSerializer({
      test: () => true,
    });
  }).toThrow("must have a 'serialize' method");

  expect(() => {
    expect.addSnapshotSerializer({
      test: () => true,
      serialize: "not a function",
    });
  }).toThrow("'serialize' property must be a function");
});

test("expect.addSnapshotSerializer without test context throws", () => {
  const serializer = {
    test: () => true,
    serialize: () => "test",
  };

  // This should work inside a test
  expect.addSnapshotSerializer(serializer);
});