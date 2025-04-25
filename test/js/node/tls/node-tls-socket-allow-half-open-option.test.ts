import { describe, expect, it } from "bun:test";
import { Duplex } from "node:stream";
import { TLSSocket } from "tls";

describe("TLSSocket allowHalfOpen option with Duplex socket", () => {
  // In both cases we should ignore allowHalfOpen option, regardless of read() {} implementation or not

  it("ignores allowHalfOpen when socket is Duplex with or without read implementation", () => {
    const duplexNoRead = new Duplex();
    const socketNoRead = new TLSSocket(duplexNoRead, { allowHalfOpen: true });
    expect(socketNoRead.allowHalfOpen).toBe(false);

    const duplexWithRead = new Duplex({ read() {} });
    const socketWithRead = new TLSSocket(duplexWithRead, { allowHalfOpen: true });
    expect(socketWithRead.allowHalfOpen).toBe(false);
  });
});
