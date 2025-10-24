/**
 * Regression tests for Node.js http.createServer() telemetry insertion points.
 * Per ADR-004: Only test that hooks are called at the correct insertion points.
 * Semantic convention mapping is tested in instrumentation package tests.
 */
import { describe, expect, test } from "bun:test";
import http from "node:http";
import { InstrumentKind } from "./types";

describe("http.createServer() telemetry insertion points", () => {
  test("calls onOperationStart when request arrives", async () => {
    let startCalled = false;
    let receivedReq: any;
    let receivedRes: any;

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-insertion-point",
      version: "1.0.0",
      onOperationStart(_id: number, attributes: any) {
        startCalled = true;
        receivedReq = attributes.http_req;
        receivedRes = attributes.http_res;
      },
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    // Verify insertion point was called with raw Node.js objects
    expect(startCalled).toBe(true);
    expect(receivedReq).toBeDefined();
    expect(receivedRes).toBeDefined();
  });
});
