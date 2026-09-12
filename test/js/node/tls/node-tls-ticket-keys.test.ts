// https://github.com/oven-sh/bun/issues/14604
import { tls as COMMON_CERT } from "harness";
import { randomBytes } from "node:crypto";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";

import { describe, expect, test } from "bun:test";

function listen(server: tls.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function connectOnce(port: number, session: Buffer | null): Promise<{ reused: boolean; session: Buffer | null }> {
  return new Promise((resolve, reject) => {
    let newSession: Buffer | null = null;
    const socket = tls.connect(
      {
        port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        // Pin TLS 1.2 so session-ticket resumption is resolved during the
        // handshake and isSessionReused() reflects it in secureConnect.
        maxVersion: "TLSv1.2",
        session: session ?? undefined,
      },
      () => {
        const reused = socket.isSessionReused();
        socket.end();
        socket.on("close", () => resolve({ reused, session: newSession }));
      },
    );
    socket.on("session", s => {
      newSession ??= s;
    });
    socket.on("error", reject);
    socket.resume();
  });
}

describe("tls.Server ticketKeys", () => {
  test("getTicketKeys returns the ticketKeys option and setTicketKeys replaces them", async () => {
    const keys = Buffer.alloc(48, 7);
    const server = tls.createServer({ ...COMMON_CERT, ticketKeys: keys });

    const before = server.getTicketKeys();
    expect(Buffer.isBuffer(before)).toBe(true);
    expect(before.length).toBe(48);
    expect(before.equals(keys)).toBe(true);
    // Returned buffer is a copy; mutating it does not change the stored keys.
    before.fill(0);
    expect(server.getTicketKeys().equals(keys)).toBe(true);

    const replacement = randomBytes(48);
    const replacementCopy = Buffer.from(replacement);
    server.setTicketKeys(replacement);
    expect(server.getTicketKeys().equals(replacementCopy)).toBe(true);
    // setTicketKeys copies its input: mutating the caller's buffer afterwards
    // must not change the keys that get applied at listen time.
    replacement.fill(0);
    expect(server.getTicketKeys().equals(replacementCopy)).toBe(true);

    try {
      await listen(server);
      expect(server.getTicketKeys().equals(replacementCopy)).toBe(true);

      const rotated = randomBytes(48);
      server.setTicketKeys(rotated);
      expect(server.getTicketKeys().equals(rotated)).toBe(true);
    } finally {
      server.close();
    }
  });

  test("getTicketKeys without the ticketKeys option returns stable 48 bytes", async () => {
    const server = tls.createServer({ ...COMMON_CERT });
    const k = server.getTicketKeys();
    expect(Buffer.isBuffer(k)).toBe(true);
    expect(k.length).toBe(48);
    // Subsequent calls are stable until setTicketKeys.
    expect(server.getTicketKeys().equals(k)).toBe(true);

    try {
      await listen(server);
      expect(server.getTicketKeys().equals(k)).toBe(true);
    } finally {
      server.close();
    }
  });

  test("getTicketKeys first called after listen() returns stable 48 bytes", async () => {
    const server = tls.createServer({ ...COMMON_CERT });
    try {
      await listen(server);
      const k = server.getTicketKeys();
      expect(Buffer.isBuffer(k)).toBe(true);
      expect(k.length).toBe(48);
      expect(server.getTicketKeys().equals(k)).toBe(true);
    } finally {
      server.close();
    }
  });

  test("setTicketKeys accepts Buffer, Uint8Array and DataView", async () => {
    const server = tls.createServer({ ...COMMON_CERT });
    try {
      await listen(server);
      const buf = Buffer.alloc(48);
      for (let i = 0; i < 48; i++) buf[i] = i;
      server.setTicketKeys(buf);
      expect(Buffer.compare(server.getTicketKeys(), buf)).toBe(0);

      const u8 = new Uint8Array(48).fill(0xab);
      server.setTicketKeys(u8);
      const afterU8 = server.getTicketKeys();
      expect({ len: afterU8.byteLength, first: afterU8[0], last: afterU8[47] }).toEqual({
        len: 48,
        first: 0xab,
        last: 0xab,
      });

      const ab = new ArrayBuffer(48);
      new Uint8Array(ab).fill(0xcd);
      server.setTicketKeys(new DataView(ab));
      const afterDV = server.getTicketKeys();
      expect({ len: afterDV.byteLength, first: afterDV[0], last: afterDV[47] }).toEqual({
        len: 48,
        first: 0xcd,
        last: 0xcd,
      });
    } finally {
      server.close();
    }
  });

  test("two servers sharing ticketKeys resume each other's sessions", async () => {
    const keys = Buffer.alloc(48, 7);
    const mk = () => {
      const s = tls.createServer({ ...COMMON_CERT, ticketKeys: keys });
      s.on("secureConnection", socket => socket.end("ok"));
      return s;
    };
    const a = mk();
    const b = mk();
    try {
      const pa = await listen(a);
      const pb = await listen(b);
      // Both servers expose the shared key material.
      expect(a.getTicketKeys().equals(keys)).toBe(true);
      expect(b.getTicketKeys().equals(keys)).toBe(true);

      const first = await connectOnce(pa, null);
      expect(first.reused).toBe(false);
      expect(first.session).not.toBeNull();

      // Offer A's ticket to B: with shared ticketKeys B can decrypt it.
      const second = await connectOnce(pb, first.session);
      expect(second.reused).toBe(true);

      // Same ticket back to A also resumes.
      const third = await connectOnce(pa, first.session);
      expect(third.reused).toBe(true);
    } finally {
      a.close();
      b.close();
    }
  });

  test("two servers with different ticketKeys do not resume each other's sessions", async () => {
    const mk = (keys: Buffer) => {
      const s = tls.createServer({ ...COMMON_CERT, ticketKeys: keys });
      s.on("secureConnection", socket => socket.end("ok"));
      return s;
    };
    const a = mk(randomBytes(48));
    const b = mk(randomBytes(48));
    try {
      const pa = await listen(a);
      const pb = await listen(b);
      const first = await connectOnce(pa, null);
      expect(first.reused).toBe(false);
      expect(first.session).not.toBeNull();

      const second = await connectOnce(pb, first.session);
      expect(second.reused).toBe(false);
    } finally {
      a.close();
      b.close();
    }
  });

  test("setTicketKeys after listen enables cross-server resumption", async () => {
    const mk = () => {
      const s = tls.createServer({ ...COMMON_CERT });
      s.on("secureConnection", socket => socket.end("ok"));
      return s;
    };
    const a = mk();
    const b = mk();
    try {
      const pa = await listen(a);
      const pb = await listen(b);
      const shared = randomBytes(48);
      a.setTicketKeys(shared);
      b.setTicketKeys(shared);
      expect(a.getTicketKeys().equals(shared)).toBe(true);
      expect(b.getTicketKeys().equals(shared)).toBe(true);

      const first = await connectOnce(pa, null);
      expect(first.reused).toBe(false);
      expect(first.session).not.toBeNull();

      const second = await connectOnce(pb, first.session);
      expect(second.reused).toBe(true);
    } finally {
      a.close();
      b.close();
    }
  });

  test("ticketKeys reach injected connections (server.emit('connection') without listen)", async () => {
    // Mirrors node's test/parallel/test-tls-ticket.js: one net.Server fronts
    // two tls.Servers that never .listen(); sockets are fed via
    // .emit('connection'). The shared ticketKeys must reach the SSL_CTX
    // backing those upgrades.
    const keys = randomBytes(48);
    const mk = () => {
      const s = tls.createServer({ ...COMMON_CERT, ticketKeys: keys });
      s.on("secureConnection", socket => socket.end("ok"));
      return s;
    };
    const a = mk();
    const b = mk();
    let turn = 0;
    await using front = net.createServer(socket => {
      (turn++ % 2 === 0 ? a : b).emit("connection", socket);
    });
    await new Promise<void>((resolve, reject) => {
      front.once("error", reject);
      front.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (front.address() as AddressInfo).port;

    expect(a.getTicketKeys().equals(keys)).toBe(true);
    expect(b.getTicketKeys().equals(keys)).toBe(true);

    const first = await connectOnce(port, null);
    expect(first.reused).toBe(false);
    expect(first.session).not.toBeNull();

    // Second connect hits `b`; with shared keys B decrypts A's ticket.
    const second = await connectOnce(port, first.session);
    expect(second.reused).toBe(true);
  });

  test("setTicketKeys validation matches Node", () => {
    const server = tls.createServer({ ...COMMON_CERT });
    expect(() => server.setTicketKeys("not a buffer" as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" }),
    );
    expect(() => server.setTicketKeys(123 as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    // Node's length check is internal/assert, not validateInteger:
    for (const len of [0, 47, 49]) {
      expect(() => server.setTicketKeys(Buffer.alloc(len))).toThrow(
        expect.objectContaining({
          code: "ERR_INTERNAL_ASSERTION",
          name: "Error",
          message: expect.stringContaining("Session ticket keys must be a 48-byte buffer"),
        }),
      );
    }
  });
});
