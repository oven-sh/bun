import { expect, test } from "bun:test";
import { tls } from "harness";
import { EventEmitter } from "node:events";
import http2 from "node:http2";

test("Http2SecureServer has captureRejectionSymbol handler matching Http2Server", () => {
  const plain = http2.createServer();
  const secure = http2.createSecureServer({ key: tls.key, cert: tls.cert });
  const sym = (EventEmitter as any).captureRejectionSymbol;
  expect(typeof (secure as any)[sym]).toBe("function");
  expect((secure as any)[sym]).toBe((plain as any)[sym]);
  plain.close();
  secure.close();
});
