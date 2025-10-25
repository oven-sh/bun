/**
 * Regression tests for Node.js http.createServer() telemetry insertion points.
 * Per ADR-004: Only test that hooks are called at the correct insertion points.
 * Semantic convention mapping is tested in instrumentation package tests.
 */
import { describe, expect, test } from "bun:test";
import http from "node:http";
import { mockInstrument } from "./hook-test-tools";
import { InstrumentKind } from "./types";

describe("http.createServer() telemetry insertion points", () => {
  test("calls onOperationStart when request arrives", async () => {
    using instrument = mockInstrument({
      type: InstrumentKind.NODE_HTTP,
      name: "calls onOperationStart when request arrives",
    });

    const server = http.createServer((req, res) => {
      console.log("Handling request");
      res.writeHead(200);
      res.end("OK");
      console.log("Response sent");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        console.log("Server listening");
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/`);
          console.log("Request sent");
          server.close(() => resolve());
          console.log("Server closed");
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });
    console.log("Server shutdown complete");
    expect(instrument.startCalls.length).toBe(1);
    const startArgs = instrument.startCalls[0];
    // Verify insertion point was called with raw Node.js objects
    expect(startArgs).toBeDefined();
    expect(startArgs.args[0]).toBeDefined();
    expect(startArgs.args[1]).toBeDefined();
    const { http_req, http_res, ...rest } = startArgs.args[1];
    expect(http_req).toBeInstanceOf(http.IncomingMessage);
    expect(http_res).toBeInstanceOf(http.ServerResponse);

    console.log("Verified onOperationStart arguments", rest);
    expect(startArgs.args[1].http_req).toBeInstanceOf(http.IncomingMessage);
    expect(startArgs.args[1].http_res).toBeInstanceOf(http.ServerResponse);

    const injectArgs = instrument.injectCalls[0];
    expect(injectArgs).toBeDefined();
    expect(injectArgs.args[0]).toBeDefined();
    expect(injectArgs.args[1]).toBeDefined();
    expect(injectArgs.args[1].http_req).toBeInstanceOf(http.IncomingMessage);
    expect(injectArgs.args[1].http_res).toBeInstanceOf(http.ServerResponse);

    expect(instrument.endCalls.length).toBe(0);
    expect(instrument.errorCalls.length).toBe(0);
    expect(instrument.progressCalls.length).toBe(0);
  });
});
