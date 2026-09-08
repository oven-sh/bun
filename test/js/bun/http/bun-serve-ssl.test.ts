import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import tls from "node:tls";
import { join } from "path";
import privateKey from "../../third_party/jsonwebtoken/priv.pem" with { type: "text" };
import publicKey from "../../third_party/jsonwebtoken/pub.pem" with { type: "text" };

describe("Bun.serve SSL validations", () => {
  const fixtures = [
    {
      label: "invalid key",
      tls: {
        key: privateKey.slice(100),
        cert: publicKey,
      },
    },
    {
      label: "invalid key #2",
      tls: {
        key: privateKey.slice(0, -20),
        cert: publicKey,
      },
    },
    {
      label: "invalid cert",
      tls: {
        key: privateKey,
        cert: publicKey.slice(0, -40),
      },
    },
    {
      label: "invalid cert #2",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "error-mc-erroryface.com",
        },
        {
          key: privateKey,
          cert: publicKey.slice(0, -40),
          serverName: "error-mc-erroryface.co.uk",
        },
      ],
    },
    {
      label: "invalid serverName: missing serverName",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "hello.com",
        },
        {
          key: privateKey,
          cert: publicKey,
        },
      ],
    },
    {
      label: "invalid serverName: empty serverName",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "hello.com",
        },
        {
          key: privateKey,
          cert: publicKey,
          serverName: "",
        },
      ],
    },
  ];
  for (const development of [true, false]) {
    for (const fixture of fixtures) {
      test(`${fixture.label} ${development ? "development" : "production"}`, () => {
        expect(() => {
          Bun.serve({
            port: 0,
            tls: fixture.tls,
            fetch: () => new Response("Hello, world!"),
            development,
          });
        }).toThrow();
      });
    }
  }

  const validFixtures = [
    {
      label: "valid",
      tls: {
        key: privateKey,
        cert: publicKey,
      },
    },
    {
      label: "valid 2",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "localhost",
        },
        {
          key: privateKey,
          cert: publicKey,
          serverName: "localhost2.com",
        },
      ],
    },
  ];
  for (const development of [true, false]) {
    for (const fixture of validFixtures) {
      test(`${fixture.label} ${development ? "development" : "production"}`, async () => {
        using server = Bun.serve({
          port: 0,
          tls: fixture.tls,
          fetch: () => new Response("Hello, world!"),
          development,
        });
        expect(server.url).toBeDefined();
        expect().pass();
        let serverNames = Array.isArray(fixture.tls) ? fixture.tls.map(({ serverName }) => serverName) : ["localhost"];

        for (const serverName of serverNames) {
          const res = await fetch(server.url, {
            headers: {
              Host: serverName,
            },
            tls: {
              rejectUnauthorized: false,
            },
            keepAlive: false,
          });
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("Hello, world!");
        }

        const res = await fetch(server.url, {
          headers: {
            Host: "badhost.com",
          },
          tls: {
            rejectUnauthorized: false,
          },
          keepAlive: false,
        });
      });
    }
  }
});

const tlsFixtures = join(import.meta.dir, "..", "..", "node", "tls", "fixtures");
const serverKey = readFileSync(join(tlsFixtures, "agent10-key.pem"), "utf8");
const serverCert = readFileSync(join(tlsFixtures, "agent10-cert.pem"), "utf8");
// ec10 chains to ca5; agent1 chains to ca1 and is not trusted by ca5.
const clientCa = readFileSync(join(tlsFixtures, "ca5-cert.pem"), "utf8");
const trustedClient = {
  key: readFileSync(join(tlsFixtures, "ec10-key.pem"), "utf8"),
  cert: readFileSync(join(tlsFixtures, "ec10-cert.pem"), "utf8"),
};
const untrustedClient = {
  key: readFileSync(join(tlsFixtures, "agent1-key.pem"), "utf8"),
  cert: readFileSync(join(tlsFixtures, "agent1-cert.pem"), "utf8"),
};

type ClientOptions = { key?: string; cert?: string; session?: Buffer };
function request(port: number, servername: string, clientTls: ClientOptions = {}) {
  const { promise, resolve } = Promise.withResolvers<{ status: string; session: Buffer | undefined }>();
  const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false, ...clientTls });
  let received = "";
  let session: Buffer | undefined;
  socket.on("secureConnect", () => {
    socket.write(`GET / HTTP/1.1\r\nHost: ${servername}\r\nConnection: close\r\n\r\n`);
  });
  socket.on("session", buf => (session ??= buf));
  socket.on("data", chunk => (received += chunk.toString()));
  // A rejected client sees either a clean close or a reset; both mean no response.
  socket.on("error", () => {});
  socket.on("close", () =>
    resolve({ status: received.split("\r\n")[0] || "connection closed without a response", session }),
  );
  return promise;
}

describe("Bun.serve tls material given both inline and as a *File path", () => {
  // agent1 chains to ca1 (given inline), ec10 chains to ca5 (given as caFile).
  const ca1 = readFileSync(join(tlsFixtures, "ca1-cert.pem"), "utf8");
  const ca5File = join(tlsFixtures, "ca5-cert.pem");

  for (const order of ["ca first", "caFile first"]) {
    test(`ca and caFile are one trust list (${order})`, async () => {
      const material = order === "ca first" ? { ca: ca1, caFile: ca5File } : { caFile: ca5File, ca: ca1 };
      using server = Bun.serve({
        port: 0,
        tls: { key: serverKey, cert: serverCert, ...material, requestCert: true, rejectUnauthorized: true },
        fetch: () => new Response("ok"),
      });
      const { status: viaInlineCa } = await request(server.port, "localhost", untrustedClient);
      const { status: viaCaFile } = await request(server.port, "localhost", trustedClient);
      const { status: noCert } = await request(server.port, "localhost");
      expect({ viaInlineCa, viaCaFile, noCert }).toEqual({
        viaInlineCa: "HTTP/1.1 200 OK",
        viaCaFile: "HTTP/1.1 200 OK",
        noCert: "connection closed without a response",
      });
    });
  }

  test("an invalid inline ca is still rejected when caFile is set", () => {
    const tls = {
      key: serverKey,
      cert: serverCert,
      ca: "-----BEGIN CERTIFICATE-----\nZ2FyYmFnZQ==\n-----END CERTIFICATE-----\n",
      caFile: ca5File,
    };
    expect(() => Bun.serve({ port: 0, tls, fetch: () => new Response("ok") })).toThrow("Failed to create HTTP server");
    // Bun.listen names the SSL context error.
    expect(() => Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { data() {} } })).toThrow(/^Invalid CA$/);
  });

  test("cert + certFile and key + keyFile throw instead of serving one of them", () => {
    const serve = (extra: object) =>
      Bun.serve({ port: 0, tls: { key: serverKey, cert: serverCert, ...extra }, fetch: () => new Response("ok") });
    expect(() => serve({ certFile: join(tlsFixtures, "agent10-cert.pem") })).toThrow(
      "TLSOptions.cert and TLSOptions.certFile cannot both be set. Pass the file as cert: Bun.file(path) instead.",
    );
    expect(() => serve({ keyFile: join(tlsFixtures, "agent10-key.pem") })).toThrow(
      "TLSOptions.key and TLSOptions.keyFile cannot both be set. Pass the file as key: Bun.file(path) instead.",
    );
  });
});

describe("Bun.serve per-serverName client certificate policy", () => {
  test("requestCert/rejectUnauthorized on a non-default serverName entry are enforced for that name only", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { key: serverKey, cert: serverCert },
        {
          serverName: "admin.example.com",
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: true,
        },
        {
          serverName: "lenient.example.com",
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: false,
        },
      ],
      fetch: req => new Response(`served ${req.headers.get("host")}`),
    });
    const { status: gatedNoCert } = await request(server.port, "admin.example.com");
    const { status: gatedTrustedCert } = await request(server.port, "admin.example.com", trustedClient);
    const { status: gatedUntrustedCert } = await request(server.port, "admin.example.com", untrustedClient);
    const { status: lenientNoCert } = await request(server.port, "lenient.example.com");
    const { status: defaultNoCert } = await request(server.port, "localhost");
    expect({ gatedNoCert, gatedTrustedCert, gatedUntrustedCert, lenientNoCert, defaultNoCert }).toEqual({
      gatedNoCert: "connection closed without a response",
      gatedTrustedCert: "HTTP/1.1 200 OK",
      gatedUntrustedCert: "connection closed without a response",
      lenientNoCert: "HTTP/1.1 200 OK",
      defaultNoCert: "HTTP/1.1 200 OK",
    });
  });

  test("a session established on the open default name cannot be resumed to bypass a gated name", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { key: serverKey, cert: serverCert },
        {
          serverName: "admin.example.com",
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: true,
        },
      ],
      fetch: req => new Response(`served ${req.headers.get("host")}`),
    });
    // Establish a resumable session on the open default name, then offer it on
    // the gated name without presenting a client certificate.
    const { status: defaultFresh, session } = await request(server.port, "localhost");
    expect(session).toBeInstanceOf(Buffer);
    const { status: defaultResumed } = await request(server.port, "localhost", { session });
    const { status: gatedResumed } = await request(server.port, "admin.example.com", { session });
    expect({ defaultFresh, defaultResumed, gatedResumed }).toEqual({
      defaultFresh: "HTTP/1.1 200 OK",
      defaultResumed: "HTTP/1.1 200 OK",
      gatedResumed: "connection closed without a response",
    });
  });
});
