import { describe, expect, test } from "bun:test";
import net from "node:net";
import tls from "node:tls";

const invalidArgType = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" });

describe("tls.createSecureContext option validation", () => {
  test("ciphers must be a string", () => {
    expect(() => tls.createSecureContext({ ciphers: 1 as any })).toThrow(invalidArgType);
  });

  test("passphrase must be a string", () => {
    expect(() => tls.createSecureContext({ key: "dummykey", passphrase: 1 as any })).toThrow(invalidArgType);
  });

  test("ecdhCurve must be a string", () => {
    expect(() => tls.createSecureContext({ ecdhCurve: 1 as any })).toThrow(invalidArgType);
  });

  test("clientCertEngine must be a string", () => {
    expect(() => tls.createSecureContext({ clientCertEngine: 0 as any })).toThrow(invalidArgType);
  });

  test("sessionTimeout must be an integer", () => {
    expect(() => tls.createSecureContext({ sessionTimeout: "abcd" as any })).toThrow(invalidArgType);
  });

  test("ticketKeys must be a Buffer", () => {
    expect(() => tls.createSecureContext({ ticketKeys: "abcd" as any })).toThrow(invalidArgType);
  });

  test("ticketKeys must be exactly 48 bytes", () => {
    expect(() => tls.createSecureContext({ ticketKeys: Buffer.alloc(0) })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("minVersion/maxVersion reject unknown protocol strings", () => {
    const err = expect.objectContaining({ code: "ERR_TLS_INVALID_PROTOCOL_VERSION", name: "TypeError" });
    expect(() => tls.createSecureContext({ minVersion: "fhqwhgads" as any })).toThrow(err);
    expect(() => tls.createSecureContext({ maxVersion: "fhqwhgads" as any })).toThrow(err);
  });
});

describe("tls.createServer option validation", () => {
  test("options must be an object", () => {
    expect(() => tls.createServer("this is not valid" as any)).toThrow(invalidArgType);
  });

  test("ciphers must be a string", () => {
    expect(() => tls.createServer({ ciphers: 1 as any })).toThrow(invalidArgType);
  });

  test("ecdhCurve must be a string", () => {
    expect(() => tls.createServer({ ecdhCurve: 1 as any })).toThrow(invalidArgType);
  });

  test("handshakeTimeout must be a number", () => {
    expect(() => tls.createServer({ handshakeTimeout: "abcd" as any })).toThrow(invalidArgType);
  });

  test("SNICallback must be a function", () => {
    for (const SNICallback of ["fhqwhgads", 42, {}, []]) {
      expect(() => tls.createServer({ SNICallback } as any)).toThrow(invalidArgType);
      expect(() => new tls.TLSSocket(new net.Socket(), { isServer: true, SNICallback } as any)).toThrow(invalidArgType);
    }
  });
});

describe("tls.Server.prototype.setTicketKeys", () => {
  const server = new tls.Server();

  test("rejects non-buffer arguments", () => {
    for (const arg of [null, undefined, 0, 1, 1n, Symbol(), {}, [], true, false, "", () => {}]) {
      expect(() => server.setTicketKeys(arg as any)).toThrow(invalidArgType);
    }
  });

  test("rejects buffers that are not 48 bytes", () => {
    for (const arg of [new Uint8Array(1), Buffer.from([1]), new DataView(new ArrayBuffer(2))]) {
      expect(() => server.setTicketKeys(arg as any)).toThrow(/Session ticket keys must be a 48-byte buffer/);
    }
  });
});

describe("tls.TLSSocket validation", () => {
  test("setServername requires a string", () => {
    const socket = new tls.TLSSocket(new net.Socket());
    for (const value of [undefined, null, 1, true, {}]) {
      expect(() => socket.setServername(value as any)).toThrow(invalidArgType);
    }
  });

  test("new TLSSocket with isServer:true marks socket as server and rejects setServername", () => {
    const socket = new tls.TLSSocket(new net.Socket(), { isServer: true } as any);
    expect(() => socket.setServername("localhost")).toThrow(
      expect.objectContaining({ code: "ERR_TLS_SNI_FROM_SERVER" }),
    );
  });

  test("renegotiate validates options and callback", () => {
    const socket = new tls.TLSSocket(new net.Socket());
    expect(() => socket.renegotiate(undefined as any, undefined)).toThrow(invalidArgType);
    expect(() => socket.renegotiate((() => {}) as any, undefined)).toThrow(invalidArgType);
    expect(() => socket.renegotiate({}, false as any)).toThrow(invalidArgType);
    expect(() => socket.renegotiate({}, null as any)).toThrow(invalidArgType);
  });
});

describe("tls.connect option validation", () => {
  test("checkServerIdentity must be a function", () => {
    for (const checkServerIdentity of [undefined, null, 1, true]) {
      expect(() => tls.connect({ checkServerIdentity } as any)).toThrow(invalidArgType);
    }
  });
});

describe("tls.convertALPNProtocols", () => {
  test("throws ERR_OUT_OF_RANGE for protocol entries longer than 255 bytes", () => {
    const out = {};
    expect(() => tls.convertALPNProtocols(["a".repeat(500)], out)).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
        message:
          "The byte length of the protocol at index 0 exceeds the maximum length. It must be <= 255. Received 500",
      }),
    );
  });

  test("copies Buffer input so the caller's buffer is not mutated", () => {
    const buffer = Buffer.from("abcd");
    const out: { ALPNProtocols?: Buffer } = {};
    tls.convertALPNProtocols(buffer, out);
    out.ALPNProtocols!.write("efgh");
    expect(buffer.equals(Buffer.from("abcd"))).toBe(true);
    expect(out.ALPNProtocols!.equals(Buffer.from("efgh"))).toBe(true);
  });

  test("copies the raw bytes of multi-byte TypedArrays", () => {
    const input = Buffer.from("abcd".repeat(8), "utf8");
    for (const Ctor of [Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) {
      const view = new Ctor(input.buffer, input.byteOffset, input.byteLength / Ctor.BYTES_PER_ELEMENT);
      const out: { ALPNProtocols?: Buffer } = {};
      tls.convertALPNProtocols(view, out);
      expect(out.ALPNProtocols!.byteLength).toBe(input.byteLength);
      expect(out.ALPNProtocols!.equals(input)).toBe(true);
    }
  });
});
