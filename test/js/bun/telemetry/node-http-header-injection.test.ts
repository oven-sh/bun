/**
 * Regression test for Node.js http.Server header injection insertion point.
 * Per ADR-004: Only test that the injection hook is called at the correct point.
 * Header merging logic is tested in instrumentation package tests.
 */
import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { InstrumentKind } from "./types";

test("calls onOperationInject before writing response headers", async () => {
  let injectCalled = false;

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-inject-insertion-point",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject(_opId: number, _data: any) {
      injectCalled = true;
      return ["00-test-trace-01"];
    },
  });

  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid address");

  try {
    await fetch(`http://localhost:${address.port}/`);

    // Verify injection insertion point was called
    expect(injectCalled).toBe(true);
  } finally {
    server.close();
  }
});
