import { expect, test } from "bun:test";
import * as net from "node:net";

test("V8StackTraceIterator handles frames without parentheses (issue #23022)", async () => {
  // This test verifies that the V8StackTraceIterator correctly parses stack traces
  // that contain frames without parentheses, such as "at unknown"

  const socket = new net.Socket();
  const { promise, resolve } = Promise.withResolvers<Error>();

  socket.on("error", resolve);
  socket.write("hello"); // This will trigger an error since socket is not connected

  const err = await promise;

  // Get the formatted error string (which internally uses V8StackTraceIterator after stack access)
  const inspected = Bun.inspect(err);

  // Count the number of "at" frames in the formatted output
  const frameCount = (inspected.match(/\n\s+at\s+/g) || []).length;

  // Should have multiple stack frames, not just one
  // Before the fix, only 1 frame would be shown after accessing error.stack
  expect(frameCount).toBeGreaterThan(3);

  // Verify the stack property itself is intact
  const stackFrames = err.stack?.split("\n").filter(line => line.trim().startsWith("at"));
  expect(stackFrames?.length).toBeGreaterThan(3);

  // The stack begins with "at unknown", the native function that made the error. That
  // line is not a frame. The frames after it are printed, down to the one of this file.
  expect(inspected).not.toContain("at unknown");
  expect(inspected).toContain("at _write");
  expect(inspected.replaceAll("\\", "/")).toContain(import.meta.path.replaceAll("\\", "/"));
});
