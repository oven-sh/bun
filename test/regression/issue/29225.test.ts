// https://github.com/oven-sh/bun/issues/29225

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { ReadableStreamBYOBReader } from "node:stream/web";

const streamWebClasses = [
  "ByteLengthQueuingStrategy",
  "CompressionStream",
  "CountQueuingStrategy",
  "DecompressionStream",
  "ReadableByteStreamController",
  "ReadableStream",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "TextDecoderStream",
  "TextEncoderStream",
  "TransformStream",
  "TransformStreamDefaultController",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
];

test.concurrent("node:stream/web classes inspect as [class X], not [class Function]", async () => {
  const source = `
    const sw = require("node:stream/web");
    const names = ${JSON.stringify(streamWebClasses)};
    for (const name of names) {
      const klass = sw[name];
      if (typeof klass !== "function") {
        console.log(name + ": MISSING");
        continue;
      }
      // Bun.inspect() uses the same formatter as console.log.
      console.log(name + ": " + Bun.inspect(klass));
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  expect(lines.length).toBe(streamWebClasses.length);

  for (let i = 0; i < streamWebClasses.length; i++) {
    const name = streamWebClasses[i];
    // Must not be "MISSING" (sanity check for the test itself) and
    // must report the real class name, not "Function".
    expect(lines[i]).not.toContain("MISSING");
    expect(lines[i]).toBe(`${name}: [class ${name}]`);
  }
  expect(exitCode).toBe(0);
});

test.concurrent("other DOM / WebCore constructors inspect as [class X]", async () => {
  // Sanity: the inspect formatter should work for any `isConstructor`
  // InternalFunction exposed as a global. Keep this list small — it's
  // a regression guard, not an audit.
  const code = `
    console.log("URL: " + Bun.inspect(URL));
    console.log("Request: " + Bun.inspect(Request));
    console.log("Response: " + Bun.inspect(Response));
    console.log("Blob: " + Bun.inspect(Blob));
    console.log("Event: " + Bun.inspect(Event));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe(
    "URL: [class URL]\n" +
      "Request: [class Request]\n" +
      "Response: [class Response]\n" +
      "Blob: [class Blob]\n" +
      "Event: [class Event]\n",
  );
  expect(exitCode).toBe(0);
});

test.concurrent("user-defined classes and extends still render correctly", async () => {
  const code = `
    class Foo {}
    class Bar extends Foo {}
    const Anon = class {};

    console.log("Foo: " + Bun.inspect(Foo));
    console.log("Bar: " + Bun.inspect(Bar));
    console.log("Anon: " + Bun.inspect(Anon));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // `Anon` picks up the "Anon" name from the variable binding, matching
  // JSC's naming inference for `const Anon = class {};`.
  expect(stdout).toBe("Foo: [class Foo]\n" + "Bar: [class Bar extends Foo]\n" + "Anon: [class Anon]\n");
  expect(exitCode).toBe(0);
});

test.concurrent("instanceof and prototype identity still work", async () => {
  // Functional behavior must not regress — the fix is cosmetic only.
  const stream = new ReadableStream({
    type: "bytes",
    start(c) {
      c.enqueue(new Uint8Array([1, 2, 3]));
      c.close();
    },
  });
  const reader = stream.getReader({ mode: "byob" });
  expect(reader).toBeInstanceOf(ReadableStreamBYOBReader);
  expect(Object.getPrototypeOf(reader)).toBe(ReadableStreamBYOBReader.prototype);
  reader.releaseLock();

  class Sub extends ReadableStreamBYOBReader {}
  expect(Object.getPrototypeOf(Sub.prototype)).toBe(ReadableStreamBYOBReader.prototype);
});
