/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * A tls.Server that has a user SNICallback does not consult its addContext()
 * entries. Node.js gives a server one selector, and the default one is the only
 * reader of the entries:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1270
 * So a name that the callback declines keeps the default context of the server:
 * its certificate and its client CA.
 */
import assert from "node:assert";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http2 from "node:http2";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");
// agent1 is issued by ca1, agent3 by ca2, and agent2 is self-signed.
const agent = (n: number) => ({ key: fixture(`agent${n}-key.pem`), cert: fixture(`agent${n}-cert.pem`) });
const isWindows = process.platform === "win32";

type Answer = (err: Error | null, ctx?: any) => void;
type SNICallback = (servername: string, answer: Answer) => void;
const nothing: SNICallback = (_servername, answer) => answer(null, undefined);

// A server whose default certificate is agent2, with an SNICallback.
function serverWith(SNICallback: SNICallback, options: tls.TlsOptions = {}) {
  const server = tls.createServer({ ...agent(2), ...options, SNICallback }, socket =>
    socket.on("error", () => {}).end(),
  );
  server.on("tlsClientError", () => {});
  return server;
}

async function listen(server: Server, path?: string) {
  if (path) server.listen(path);
  else server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

// What a client dials to reach `server`.
function whereIs(server: Server) {
  const address = server.address() as AddressInfo | string;
  return typeof address === "string" ? { path: address } : { port: address.port, host: "127.0.0.1" };
}

// The CN of the certificate that the server presents for `servername`.
async function servedCN(server: Server, servername: string) {
  const client = tls.connect({ ...whereIs(server), servername, rejectUnauthorized: false });
  try {
    await once(client, "secureConnect");
    return client.getPeerCertificate().subject.CN;
  } finally {
    client.destroy();
  }
}

describe("a listening tls.Server with an SNICallback that selects nothing", () => {
  const forms: [string, (answer: Answer) => void][] = [
    ["cb()", answer => (answer as () => void)()],
    ["cb(null, undefined)", answer => answer(null, undefined)],
    ["cb(null, null)", answer => answer(null, null)],
    ["cb(null, undefined) on a later turn", answer => void setImmediate(answer, null, undefined)],
    ["cb(null, null) on a later turn", answer => void setImmediate(answer, null, null)],
  ];
  for (const [form, decline] of forms) {
    test(`${form} serves the default context, not an addContext() entry`, async () => {
      const asked: string[] = [];
      const server = serverWith((servername, answer) => {
        asked.push(servername);
        decline(answer);
      });
      server.addContext("entry.test", agent(3));
      await listen(server);
      try {
        assert.deepStrictEqual(
          { served: await servedCN(server, "entry.test"), asked },
          { served: "agent2", asked: ["entry.test"] },
        );
      } finally {
        server.close();
      }
    });
  }

  for (const when of ["after listen()", "inside the callback", "while the answer is pending"]) {
    test(`an entry that addContext() adds ${when} is not consulted`, async () => {
      const pending = Promise.withResolvers<Answer>();
      const server = serverWith((servername, answer) => {
        if (when === "inside the callback") server.addContext(servername, agent(3));
        if (when === "while the answer is pending") return pending.resolve(answer);
        answer(null, undefined);
      });
      await listen(server);
      try {
        if (when === "after listen()") server.addContext("entry.test", agent(3));
        const served = servedCN(server, "entry.test");
        if (when === "while the answer is pending") {
          const answer = await pending.promise;
          server.addContext("entry.test", agent(3));
          answer(null, undefined);
        }
        assert.strictEqual(await served, "agent2");
      } finally {
        server.close();
      }
    });
  }

  test("a callback that selects a context for one name keeps the default for the names of an exact and a wildcard entry", async () => {
    const selected = tls.createSecureContext(agent(1));
    const server = serverWith((servername, answer) =>
      answer(null, servername === "selected.test" ? selected : undefined),
    );
    server.addContext("selected.test", agent(3));
    server.addContext("exact.test", agent(3));
    server.addContext("*.wild.test", agent(3));
    await listen(server);
    try {
      assert.deepStrictEqual(
        {
          selected: await servedCN(server, "selected.test"),
          exact: await servedCN(server, "exact.test"),
          wildcard: await servedCN(server, "a.wild.test"),
          noEntry: await servedCN(server, "other.test"),
        },
        { selected: "agent1", exact: "agent2", wildcard: "agent2", noEntry: "agent2" },
      );
    } finally {
      server.close();
    }
  });

  test("the client CA of the default context judges the client, not the client CA of the entry", async () => {
    const ca = (n: number) => fixture(`ca${n}-cert.pem`);
    const server = serverWith(nothing, { ca: ca(1), requestCert: true, rejectUnauthorized: true });
    server.addContext("entry.test", { ...agent(3), ca: ca(2) });
    await listen(server);
    // How the server judges a client that presents the certificate of agent `n`.
    async function verdict(n: number) {
      const judged = Promise.race([
        once(server, "secureConnection").then(() => "accepted"),
        once(server, "tlsClientError").then(() => "refused"),
      ]);
      const client = tls.connect({
        ...whereIs(server),
        servername: "entry.test",
        ...agent(n),
        rejectUnauthorized: false,
      });
      client.on("error", () => {});
      try {
        return await judged;
      } finally {
        client.destroy();
      }
    }
    try {
      assert.deepStrictEqual(
        { "a client of ca1": await verdict(1), "a client of ca2": await verdict(3) },
        { "a client of ca1": "accepted", "a client of ca2": "refused" },
      );
    } finally {
      server.close();
    }
  });

  test("close() and a second listen() keep the default context", async () => {
    const server = serverWith(nothing);
    server.addContext("entry.test", agent(3));
    const served: unknown[] = [];
    for (let round = 0; round < 2; round++) {
      await listen(server);
      try {
        served.push(await servedCN(server, "entry.test"));
      } finally {
        const closed = once(server, "close");
        server.close();
        await closed;
      }
    }
    assert.deepStrictEqual(served, ["agent2", "agent2"]);
  });

  test("a server that listens on a path serves the default context", async () => {
    // A unix socket. On Windows the path that a server listens on is a named pipe.
    // Node.js runs this file too, so the directory does not come from the Bun test harness.
    const dir = isWindows ? undefined : mkdtempSync(join(tmpdir(), "tls-sni-callback-"));
    const path = dir ? join(dir, "tls.sock") : `\\\\.\\pipe\\tls-sni-callback-${process.pid}`;
    const server = serverWith(nothing);
    server.addContext("entry.test", agent(3));
    try {
      await listen(server, path);
      assert.strictEqual(await servedCN(server, "entry.test"), "agent2");
    } finally {
      server.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  test("http2.createSecureServer() serves the default context, over h2", async () => {
    const server = http2.createSecureServer({ ...agent(2), SNICallback: nothing }, (_req, res) => res.end("over h2"));
    server.addContext("entry.test", agent(3));
    await listen(server);
    const { port } = server.address() as AddressInfo;
    const session = http2.connect(`https://127.0.0.1:${port}`, { servername: "entry.test", rejectUnauthorized: false });
    try {
      const failed = once(session, "error").then(([err]) => Promise.reject(err));
      const [, socket] = (await Promise.race([once(session, "connect"), failed])) as [unknown, tls.TLSSocket];
      const served = socket.getPeerCertificate().subject.CN;
      const request = session.request({ ":path": "/" }).setEncoding("utf8");
      let body = "";
      request.on("data", chunk => (body += chunk));
      await Promise.race([once(request, "end"), failed]);
      assert.deepStrictEqual(
        { served, alpn: socket.alpnProtocol, body },
        { served: "agent2", alpn: "h2", body: "over h2" },
      );
    } finally {
      session.destroy();
      server.close();
    }
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
