import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("ReadableStream conversion methods", () => {
  test("Bun.spawn() process.stdout.text() should capture process output", async () => {
    // Spawn a process that outputs some text
    await using process = Bun.spawn([bunExe(), "-e", "console.log('Hello from Bun spawn! 🚀')"], {
      env: bunEnv,
    });

    // Convert the process stdout to text using .text()
    const result = await process.stdout.text();
    await process.exited;

    expect(result).toBe("Hello from Bun spawn! 🚀\n");
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.text() should capture process output (after exited)", async () => {
    // Spawn a process that outputs some text
    await using process = Bun.spawn([bunExe(), "-e", "console.log('Hello from Bun spawn! 🚀')"], {
      env: bunEnv,
    });

    await process.exited;

    // Convert the process stdout to text using .text()
    const result = await process.stdout.text();

    expect(result).toBe("Hello from Bun spawn! 🚀\n");
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.text() should convert stream to text", async () => {
    // Spawn a process that outputs text
    const text = "Hello, this is a test stream! 🌊 测试";
    await using process = Bun.spawn([bunExe(), "-e", `console.log("${text}")`], {
      env: bunEnv,
    });

    // Convert the process stdout to text using .text()
    const result = await process.stdout.text();
    await process.exited;

    expect(result.trim()).toBe(text);
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.text() should convert stream to text (after exited)", async () => {
    // Spawn a process that outputs text
    const text = "Hello, this is a test stream! 🌊 测试";
    await using process = Bun.spawn([bunExe(), "-e", `console.log("${text}")`], {
      env: bunEnv,
    });

    await process.exited;

    // Convert the process stdout to text using .text()
    const result = await process.stdout.text();

    expect(result.trim()).toBe(text);
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.json() should convert stream to JSON", async () => {
    // Spawn a process that outputs JSON data
    const jsonData = { message: "Hello from JSON stream! 🎯", count: 42, active: true, emoji: "🌟" };
    await using process = Bun.spawn([bunExe(), "-e", `console.log('${JSON.stringify(jsonData)}')`], {
      env: bunEnv,
    });

    // Convert the process stdout to JSON using .json()
    const result = await process.stdout.json();
    await process.exited;

    expect(result).toEqual(jsonData);
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.json() should convert stream to JSON (after exited)", async () => {
    // Spawn a process that outputs JSON data
    const jsonData = { message: "Hello from JSON stream! 🎯", count: 42, active: true, emoji: "🌟" };
    await using process = Bun.spawn([bunExe(), "-e", `console.log('${JSON.stringify(jsonData)}')`], {
      env: bunEnv,
    });

    await process.exited;

    // Convert the process stdout to JSON using .json()
    const result = await process.stdout.json();

    expect(result).toEqual(jsonData);
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.json() should throw on invalid JSON", async () => {
    // Spawn a process that outputs invalid JSON
    const invalidJson = "{ invalid json content }";
    await using process = Bun.spawn([bunExe(), "-e", `console.log('${invalidJson}')`], {
      env: bunEnv,
    });

    // Attempt to convert the process stdout to JSON using .json()
    // check that it doesn't throw synchronously.
    const result = process.stdout.json();
    expect(result).toBeInstanceOf(Promise);

    expect(async () => await result).toThrowErrorMatchingInlineSnapshot(`"JSON Parse error: Expected '}'"`);
    await process.exited;

    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.json() should throw on invalid JSON (after exited)", async () => {
    // Spawn a process that outputs invalid JSON
    const invalidJson = "{ invalid json content }";
    await using process = Bun.spawn([bunExe(), "-e", `console.log('${invalidJson}')`], {
      env: bunEnv,
    });

    await process.exited;

    // Attempt to convert the process stdout to JSON using .json()

    const result = process.stdout.json();
    // Check it doesn't throw synchronously.
    expect(result).toBeInstanceOf(Promise);

    // TODO: why is the error message different here??
    expect(async () => await result).toThrowErrorMatchingInlineSnapshot(`"Failed to parse JSON"`);

    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.blob() should convert stream to Blob", async () => {
    // Generate random binary data
    const randomBytes = new Uint8Array(256);
    crypto.getRandomValues(randomBytes);
    const binaryData = Buffer.from(randomBytes);

    await using process = Bun.spawn(
      [bunExe(), "-e", `process.stdout.write(Buffer.from([${Array.from(binaryData)}]))`],
      {
        env: bunEnv,
      },
    );

    // Convert the process stdout to Blob using .blob()
    const result = await process.stdout.blob();
    await process.exited;

    // Compare the Blob directly with the original binary data
    expect(await result.bytes()).toEqual(new Uint8Array(binaryData));
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.bytes() should convert stream to Uint8Array", async () => {
    // Generate random binary data
    const randomBytes = new Uint8Array(128);
    crypto.getRandomValues(randomBytes);
    const binaryData = Buffer.from(randomBytes);

    await using process = Bun.spawn(
      [bunExe(), "-e", `process.stdout.write(Buffer.from([${Array.from(binaryData)}]))`],
      {
        env: bunEnv,
      },
    );

    // Convert the process stdout to Uint8Array using .bytes()
    const result = await process.stdout.bytes();
    await process.exited;

    // Compare the Uint8Array directly with the original binary data
    expect(result).toEqual(new Uint8Array(binaryData));
    expect(process.exitCode).toBe(0);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  for (const method of ["text", "json", "bytes", "blob"] as const) {
    describe(`ReadableStream.prototype.${method}() should throw when called with wrong this value`, () => {
      for (const thisValue of [null, undefined, "not a stream", {}, []]) {
        test(String(thisValue), () => {
          // Test that calling .text() with wrong this value throws an error
          // @ts-ignore
          const fn = ReadableStream.prototype[method];
          expect(() => {
            fn.call(thisValue);
          }).toThrowError(
            expect.objectContaining({
              code: "ERR_INVALID_THIS",
            }),
          );
        });
      }
    });
  }
});
