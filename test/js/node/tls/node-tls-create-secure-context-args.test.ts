import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import * as tls from "node:tls";

const agent1Key = readFileSync(join(import.meta.dir, "fixtures", "agent1-key.pem"));
const agent1Cert = readFileSync(join(import.meta.dir, "fixtures", "agent1-cert.pem"));
const ca1 = readFileSync(join(import.meta.dir, "fixtures", "ca1-cert.pem"));

function asDataView(buf: Buffer): DataView {
  // Back the view with a fresh ArrayBuffer holding exactly these bytes.
  const copy = new Uint8Array(buf);
  return new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
}

describe("tls.createSecureContext key/cert/ca input types", () => {
  // Node.js accepts any ArrayBufferView (Buffer, TypedArray, DataView) for
  // key/cert/ca; the error message Bun emits on rejection even lists DataView
  // as an accepted type, so rejecting a DataView contradicts Bun's own message.
  it("accepts DataView for key, cert, and ca", () => {
    expect(() => tls.createSecureContext({ key: asDataView(agent1Key), cert: agent1Cert })).not.toThrow();
    expect(() => tls.createSecureContext({ key: agent1Key, cert: asDataView(agent1Cert) })).not.toThrow();
    expect(() => tls.createSecureContext({ ca: asDataView(ca1) })).not.toThrow();
    expect(() => tls.createSecureContext({ ca: [asDataView(ca1)] })).not.toThrow();
    expect(() =>
      tls.createSecureContext({ key: asDataView(agent1Key), cert: asDataView(agent1Cert), ca: asDataView(ca1) }),
    ).not.toThrow();
  });

  it("DataView key/cert/ca produce a working TLS connection", async () => {
    const server = tls.createServer(
      { key: asDataView(agent1Key), cert: asDataView(agent1Cert) },
      socket => {
        socket.end("hello");
      },
    );
    try {
      server.listen(0);
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;

      const received = await new Promise<string>((resolve, reject) => {
        const client = tls.connect({ port, host: "127.0.0.1", ca: asDataView(ca1), servername: "agent1" });
        let data = "";
        client.on("data", chunk => (data += chunk));
        client.on("end", () => resolve(data));
        client.on("error", reject);
      });
      expect(received).toBe("hello");
    } finally {
      server.close();
    }
  });

  it("still rejects types that are neither string nor ArrayBufferView", () => {
    expect(() => tls.createSecureContext({ key: 123 as any, cert: agent1Cert })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => tls.createSecureContext({ cert: {} as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

describe("tls.createSecureContext extra arguments test", () => {
  it("should throw an error if the privateKeyEngine is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: 0 })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: true })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: {} })).toThrow(
      "string or one of null or undefined",
    );
  });

  it("should throw an error if the privateKeyIdentifier is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {}, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
  });

  it("should throw with a valid privateKeyIdentifier but missing privateKeyEngine", () => {
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid" })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });

  it("should not throw for invalid privateKeyEngine when privateKeyIdentifier is not provided", () => {
    // Node.js does not throw an error in the case where only privateKeyEngine is provided, even if
    // the key is invalid. The checks for both keys are only done when privateKeyIdentifier is passed.
    // Verifiable with: `node -p 'tls.createSecureContext({ privateKeyEngine: 0 })'`

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: 0 })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: true })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: {} })).not.toThrow();
  });

  it("should throw for invalid privateKeyIdentifier", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0 })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {} })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });
});
