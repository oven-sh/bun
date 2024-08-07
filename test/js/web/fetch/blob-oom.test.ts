import { afterAll, afterEach, beforeAll, describe, expect, it, test } from "bun:test";
afterEach(() => {
  Bun.gc(true);
});

describe("Blob", () => {
  let buf: ArrayBuffer;
  beforeAll(() => {
    buf = new ArrayBuffer(Math.floor(512 * 1024 * 1024));
  });

  test(".json() should throw an OOM without crashing the process.", () => {
    const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
    expect(async () => await new Blob(array).json()).toThrow(
      "Cannot parse a JSON string longer than 2^32-1 characters",
    );
  });

  test(".text() should throw an OOM without crashing the process.", () => {
    const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
    expect(async () => await new Blob(array).text()).toThrow("Cannot create a string longer than 2^32-1 characters");
  });

  test(".arrayBuffer() should throw an OOM without crashing the process.", () => {
    const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
    expect(async () => await new Blob(array).arrayBuffer()).toThrow("Out of memory");
  });
});

describe("Response", () => {
  let blob: Blob;
  beforeAll(() => {
    const buf = new ArrayBuffer(Math.floor(512 * 1024 * 1024));
    blob = new Blob([buf, buf, buf, buf, buf, buf, buf, buf, buf]);
  });
  afterAll(() => {
    blob = undefined;
  });

  test(".text() should throw an OOM without crashing the process.", () => {
    expect(async () => await new Response(blob).text()).toThrow("Cannot create a string longer than 2^32-1 characters");
  });

  test(".arrayBuffer() should throw an OOM without crashing the process.", async () => {
    expect(async () => await new Response(blob).arrayBuffer()).toThrow("Out of memory");
  });

  test(".json() should throw an OOM without crashing the process.", async () => {
    expect(async () => await new Response(blob).json()).toThrow(
      "Cannot parse a JSON string longer than 2^32-1 characters",
    );
  });
});

describe("Request", () => {
  let blob: Blob;
  beforeAll(() => {
    const buf = new ArrayBuffer(Math.floor(512 * 1024 * 1024));
    blob = new Blob([buf, buf, buf, buf, buf, buf, buf, buf, buf]);
  });
  afterAll(() => {
    blob = undefined;
  });

  test(".text() should throw an OOM without crashing the process.", () => {
    expect(async () => await new Request("http://localhost:3000", { body: blob }).text()).toThrow(
      "Cannot create a string longer than 2^32-1 characters",
    );
  });

  test(".arrayBuffer() should throw an OOM without crashing the process.", async () => {
    expect(async () => await new Request("http://localhost:3000", { body: blob }).arrayBuffer()).toThrow(
      "Out of memory",
    );
  });

  test(".json() should throw an OOM without crashing the process.", async () => {
    expect(async () => await new Request("http://localhost:3000", { body: blob }).json()).toThrow(
      "Cannot parse a JSON string longer than 2^32-1 characters",
    );
  });
});
