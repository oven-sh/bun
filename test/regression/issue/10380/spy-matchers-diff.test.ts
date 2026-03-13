import { expect, mock, test } from "bun:test";

const stripAnsi = (str: string) => str.replaceAll(/\x1b\[[0-9;]*m/g, "");

test("toHaveBeenCalledWith should show diff when assertion fails", () => {
  const mockedFn = mock(args => args);

  const a = { a: { b: { c: { d: 1 } } } };
  const b = { a: { b: { c: { d: 2 } } } };

  mockedFn(a);

  let error: Error | undefined;
  try {
    expect(mockedFn).toHaveBeenCalledWith(b);
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeDefined();
  expect(error!.message).toContain("- Expected");
  expect(error!.message).toContain("+ Received");
  expect(stripAnsi(error!.message)).toContain('"d": 1');
  expect(stripAnsi(error!.message)).toContain('"d": 2');
});

test("toHaveBeenNthCalledWith should show diff when assertion fails", () => {
  const mockedFn = mock(args => args);

  const a = { x: [1, 2, 3] };
  const b = { x: [1, 2, 4] };

  mockedFn(a);

  let error: Error | undefined;
  try {
    expect(mockedFn).toHaveBeenNthCalledWith(1, b);
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeDefined();
  expect(error!.message).toContain("- Expected");
  expect(error!.message).toContain("+ Received");
});

test("toHaveBeenLastCalledWith should show diff when assertion fails", () => {
  const mockedFn = mock(args => args);

  const a = { nested: { value: "hello" } };
  const b = { nested: { value: "world" } };

  mockedFn("first");
  mockedFn(a);

  let error: Error | undefined;
  try {
    expect(mockedFn).toHaveBeenLastCalledWith(b);
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeDefined();
  expect(error!.message).toContain("- Expected");
  expect(error!.message).toContain("+ Received");
  expect(error!.message).toContain("hello");
  expect(error!.message).toContain("world");
});

test("toHaveBeenCalledWith should show diff for multiple arguments", () => {
  const mockedFn = mock((a, b, c) => [a, b, c]);

  mockedFn(1, { foo: "bar" }, [1, 2, 3]);

  let error: Error | undefined;
  try {
    expect(mockedFn).toHaveBeenCalledWith(1, { foo: "baz" }, [1, 2, 4]);
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeDefined();
  expect(error!.message).toContain("- Expected");
  expect(error!.message).toContain("+ Received");
  expect(stripAnsi(error!.message)).toContain("bar");
  expect(stripAnsi(error!.message)).toContain("baz");
});

test("toHaveBeenCalledWith should show diff for complex nested structures", () => {
  const mockedFn = mock(args => args);

  const received = {
    users: [
      { id: 1, name: "Alice", roles: ["admin", "user"] },
      { id: 2, name: "Bob", roles: ["user"] },
    ],
    settings: {
      theme: "dark",
      notifications: { email: true, push: false },
    },
  };

  const expected = {
    users: [
      { id: 1, name: "Alice", roles: ["admin", "user"] },
      { id: 2, name: "Bob", roles: ["moderator", "user"] },
    ],
    settings: {
      theme: "light",
      notifications: { email: true, push: false },
    },
  };

  mockedFn(received);

  let error: Error | undefined;
  try {
    expect(mockedFn).toHaveBeenCalledWith(expected);
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeDefined();
  expect(error!.message).toContain("- Expected");
  expect(error!.message).toContain("+ Received");
  expect(error!.message).toContain("dark");
  expect(error!.message).toContain("light");
  expect(error!.message).toContain("moderator");
});
