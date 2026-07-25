import { tls as COMMON_CERT } from "harness";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
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

    await listen(server);
    try {
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

    await listen(server);
    try {
      expect(server.getTicketKeys().equals(k)).toBe(true);
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
    const pa = await listen(a);
    const pb = await listen(b);
    try {
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
    const pa = await listen(a);
    const pb = await listen(b);
    try {
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
    const pa = await listen(a);
    const pb = await listen(b);
    try {
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

  test("setTicketKeys validates its argument with the Node error codes", () => {
    const server = tls.createServer({ ...COMMON_CERT });
    expect(() => server.setTicketKeys("not a buffer" as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => server.setTicketKeys(Buffer.alloc(0))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => server.setTicketKeys(Buffer.alloc(47))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => server.setTicketKeys(Buffer.alloc(49))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });
});
