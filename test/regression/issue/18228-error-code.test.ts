import { expect, test } from "bun:test";

// Test specifically for the new ERR_WRITABLE_STREAM_ALREADY_CLOSED error code
test("ERR_WRITABLE_STREAM_ALREADY_CLOSED error code behavior", async () => {
  const { writable } = new TransformStream();

  // Close the stream
  await writable.close();

  // Try to close again
  try {
    await writable.close();
    expect(true).toBe(false); // Should not reach here
  } catch (err: any) {
    // Verify error properties
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_WRITABLE_STREAM_ALREADY_CLOSED");
    expect(err.message).toBe("Cannot close a stream that has already been closed");
    expect(err.name).toBe("TypeError");
  }
});

test("WritableStream.close on errored stream returns stored error", async () => {
  const customError = new Error("Custom test error");
  customError.name = "CustomError";

  const writable = new WritableStream({
    start(controller) {
      controller.error(customError);
    },
  });

  try {
    await writable.close();
    expect(true).toBe(false); // Should not reach here
  } catch (err: any) {
    // Should return the exact stored error, not a new one
    expect(err).toBe(customError);
    expect(err.message).toBe("Custom test error");
    expect(err.name).toBe("CustomError");
  }
});

test("WritableStream writer.close behaves consistently", async () => {
  const { writable } = new TransformStream();
  const writer = writable.getWriter();

  // Close via writer
  await writer.close();

  // Try to close again via writer
  try {
    await writer.close();
    expect(true).toBe(false); // Should not reach here
  } catch (err: any) {
    // Should get the same error code
    expect(err.code).toBe("ERR_WRITABLE_STREAM_ALREADY_CLOSED");
    expect(err.message).toBe("Cannot close a stream that has already been closed");
  }
});
