// https://github.com/oven-sh/bun/issues/12157
// https.Server should expose the same SNI helpers as tls.Server.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const fixtures = join(import.meta.dir, "..", "tls", "fixtures");
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

const agent1Cert = load("agent1-cert.pem");
const agent1Key = load("agent1-key.pem");
const agent2Cert = load("agent2-cert.pem");
const agent2Key = load("agent2-key.pem");
const agent3Cert = load("agent3-cert.pem");
const agent3Key = load("agent3-key.pem");
const ca1 = load("ca1-cert.pem");

async function peerCN(port: number, servername?: string) {
  const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false });
  const errored = once(socket, "error");
  await Promise.race([once(socket, "secureConnect"), errored.then(([e]) => Promise.reject(e))]);
  const cert = socket.getPeerCertificate();
  socket.destroy();
  return cert.subject?.CN;
}

async function httpsGetViaSNI(port: number, servername: string) {
  const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false });
  const errored = once(socket, "error").then(([e]) => Promise.reject(e));
  try {
    await Promise.race([once(socket, "secureConnect"), errored]);
    const cn = socket.getPeerCertificate().subject?.CN;
    socket.write(`GET / HTTP/1.1\r\nHost: ${servername}\r\nConnection: close\r\n\r\n`);
    const chunks: Buffer[] = [];
    socket.on("data", c => chunks.push(c));
    await Promise.race([once(socket, "end"), once(socket, "close"), errored]);
    const raw = Buffer.concat(chunks).toString("utf8");
    const sep = raw.indexOf("\r\n\r\n");
    return { cn, body: sep >= 0 ? raw.slice(sep + 4) : raw };
  } finally {
    socket.destroy();
  }
}

async function listen(server: https.Server) {
  const listenErr = once(server, "error");
  server.listen(0);
  await Promise.race([once(server, "listening"), listenErr.then(([e]) => Promise.reject(e))]);
  return (server.address() as AddressInfo).port;
}

describe("https.Server", () => {
  test("exposes tls.Server methods and is an http.Server subclass", () => {
    const server = https.createServer({ key: agent1Key, cert: agent1Cert });
    expect({
      addContext: typeof server.addContext,
      setSecureContext: typeof server.setSecureContext,
      getTicketKeys: typeof server.getTicketKeys,
      setTicketKeys: typeof server.setTicketKeys,
    }).toEqual({
      addContext: "function",
      setSecureContext: "function",
      getTicketKeys: "function",
      setTicketKeys: "function",
    });
    expect(server instanceof https.Server).toBe(true);
    expect(server instanceof http.Server).toBe(true);
    expect(() => server.addContext(123 as any, {})).toThrow(TypeError);
    expect(() => server.addContext(123 as any, {})).toThrow("hostname must be a string");
  });

  test("addContext registers a SNI context before listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      server.addContext("b.example.com", { key: agent3Key, cert: agent3Cert });

      const port = await listen(server);

      expect(await peerCN(port, "a.example.com")).toBe("agent1");
      expect(await peerCN(port, "b.example.com")).toBe("agent3");
      // A hostname with no SNI match falls through to the default context.
      expect(await peerCN(port, "unknown.example.com")).toBe("agent2");
    } finally {
      server.close();
    }
  });

  test("addContext registers a SNI context after listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      const port = await listen(server);
      expect(await peerCN(port, "a.example.com")).toBe("agent2");

      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      server.addContext("b.example.com", { key: agent3Key, cert: agent3Cert });

      expect(await peerCN(port, "a.example.com")).toBe("agent1");
      expect(await peerCN(port, "b.example.com")).toBe("agent3");
      expect(await peerCN(port, "unknown.example.com")).toBe("agent2");

      // The SNI-selected domain must also have routes installed (not just
      // a TLS context), so an HTTP request over that SNI reaches the
      // request handler.
      expect(await httpsGetViaSNI(port, "a.example.com")).toEqual({ cn: "agent1", body: "ok" });
      expect(await httpsGetViaSNI(port, "b.example.com")).toEqual({ cn: "agent3", body: "ok" });
    } finally {
      server.close();
    }
  });

  test("addContext with a repeated hostname replaces the previous context", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      server.addContext("a.example.com", { key: agent3Key, cert: agent3Cert });

      const port = await listen(server);
      // pre-listen: the most recently added context wins
      expect(await peerCN(port, "a.example.com")).toBe("agent3");

      // post-listen: re-adding the same hostname replaces rather than throws
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      expect(await peerCN(port, "a.example.com")).toBe("agent1");
      expect(await httpsGetViaSNI(port, "a.example.com")).toEqual({ cn: "agent1", body: "ok" });

      server.addContext("a.example.com", { key: agent3Key, cert: agent3Cert });
      expect(await peerCN(port, "a.example.com")).toBe("agent3");

      // A re-add with a malformed cert throws, and must not strip the
      // previous working SNI entry.
      expect(() =>
        server.addContext("a.example.com", { key: agent1Key, cert: "-----BEGIN CERTIFICATE-----\ntruncated" }),
      ).toThrow();
      expect(await peerCN(port, "a.example.com")).toBe("agent3");
    } finally {
      server.close();
    }
  });

  test("addContext re-add does not break keep-alive connections on the previous SNI context", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200, { "Content-Length": "2" });
      res.end("ok");
    });
    try {
      const port = await listen(server);
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });

      const socket = tls.connect({ host: "127.0.0.1", port, servername: "a.example.com", rejectUnauthorized: false });
      const errored = once(socket, "error").then(([e]) => Promise.reject(e));
      const closed = once(socket, "close").then(() => Promise.reject(new Error("socket closed before response")));
      try {
        await Promise.race([once(socket, "secureConnect"), errored]);
        expect(socket.getPeerCertificate().subject?.CN).toBe("agent1");

        const readResponse = async () => {
          const chunks: Buffer[] = [];
          while (true) {
            const [chunk] = await Promise.race([once(socket, "data"), closed, errored]);
            chunks.push(chunk);
            const raw = Buffer.concat(chunks).toString("utf8");
            const sep = raw.indexOf("\r\n\r\n");
            if (sep >= 0 && raw.length >= sep + 4 + 2) return raw.slice(sep + 4, sep + 4 + 2);
          }
        };

        socket.write("GET / HTTP/1.1\r\nHost: a.example.com\r\n\r\n");
        expect(await readResponse()).toBe("ok");

        // Replace the SNI context while the keep-alive connection is open;
        // the per-domain router for the previous SSL_CTX is freed here.
        server.addContext("a.example.com", { key: agent3Key, cert: agent3Cert });

        // A second request on the same connection must fall back to the
        // default router rather than dereferencing the freed per-domain one.
        socket.write("GET / HTTP/1.1\r\nHost: a.example.com\r\n\r\n");
        expect(await readResponse()).toBe("ok");
      } finally {
        socket.destroy();
      }
    } finally {
      server.close();
    }
  });

  test("setSecureContext replaces the default context before listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.setSecureContext({ key: agent3Key, cert: agent3Cert });
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent3");
    } finally {
      server.close();
    }
  });

  test("setSecureContext on a server with no initial TLS options does not require a client certificate", async () => {
    const server = https.createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.setSecureContext({ key: agent1Key, cert: agent1Cert, ca: ca1 });
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent1");
    } finally {
      server.close();
    }
  });
});
