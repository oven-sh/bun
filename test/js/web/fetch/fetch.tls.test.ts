import { it, expect } from "bun:test";
import tls from "tls";
import { join } from "node:path";
import { bunEnv, bunExe } from "harness";

type TLSOptions = {
  cert: string;
  key: string;
  passphrase?: string;
};

import { tls as cert1, expiredTls as cert2 } from "harness";

const CERT_LOCALHOST_IP = { ...cert1 };
const CERT_EXPIRED = { ...cert2 };

// Note: Do not use bun.sh as the example domain
// Cloudflare sometimes blocks automated requests to it.
// so it will cause flaky tests.
async function createServer(cert: TLSOptions, callback: (port: number) => Promise<any>) {
  using server = Bun.serve({
    port: 0,
    tls: cert,
    fetch() {
      return new Response("Hello World");
    },
  });
  await callback(server.port);
}

it("can handle multiple requests with non native checkServerIdentity", async () => {
  async function request() {
    let called = false;
    const result = await fetch("https://www.example.com", {
      keepalive: false,
      tls: {
        checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
          called = true;
          return tls.checkServerIdentity(hostname, cert);
        },
      },
    }).then((res: Response) => res.blob());
    expect(result?.size).toBeGreaterThan(0);
    expect(called).toBe(true);
  }
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(request());
  }
  await Promise.all(promises);
});

it("fetch with valid tls should not throw", async () => {
  const promises = [`https://example.com`, `https://www.example.com`].map(async url => {
    const result = await fetch(url, { keepalive: false }).then((res: Response) => res.blob());
    expect(result?.size).toBeGreaterThan(0);
  });

  await Promise.all(promises);
});

it("fetch with valid tls and non-native checkServerIdentity should work", async () => {
  for (const isBusy of [true, false]) {
    let count = 0;
    const promises = [`https://example.com`, `https://www.example.com`].map(async url => {
      await fetch(url, {
        keepalive: false,
        tls: {
          checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
            count++;
            expect(url).toContain(hostname);
            return tls.checkServerIdentity(hostname, cert);
          },
        },
      }).then((res: Response) => res.blob());
    });
    if (isBusy) {
      const start = performance.now();
      while (performance.now() - start < 500) {}
    }
    await Promise.all(promises);
    expect(count).toBe(2);
  }
});

it("fetch with valid tls and non-native checkServerIdentity should work", async () => {
  let count = 0;
  const promises = [`https://example.com`, `https://www.example.com`].map(async url => {
    await fetch(url, {
      keepalive: false,
      tls: {
        checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
          count++;
          expect(url).toContain(hostname);
          throw new Error("CustomError");
        },
      },
    });
  });
  const start = performance.now();
  while (performance.now() - start < 1000) {}
  expect((await Promise.allSettled(promises)).every(p => p.status === "rejected")).toBe(true);
  expect(count).toBe(2);
});

it("fetch with rejectUnauthorized: false should not call checkServerIdentity", async () => {
  let count = 0;

  await fetch("https://example.com", {
    keepalive: false,
    tls: {
      rejectUnauthorized: false,
      checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
        count++;
        return tls.checkServerIdentity(hostname, cert);
      },
    },
  }).then((res: Response) => res.blob());
  expect(count).toBe(0);
});

it("fetch with self-sign tls should throw", async () => {
  await createServer(CERT_LOCALHOST_IP, async port => {
    const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
    await Promise.all(
      urls.map(async url => {
        try {
          await fetch(url).then((res: Response) => res.blob());
          expect.unreachable();
        } catch (e: any) {
          expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
        }
      }),
    );
  });
});

it("fetch with invalid tls should throw", async () => {
  await createServer(CERT_EXPIRED, async port => {
    await Promise.all(
      [`https://localhost:${port}`, `https://127.0.0.1:${port}`].map(async url => {
        try {
          await fetch(url).then((res: Response) => res.blob());
          expect.unreachable();
        } catch (e: any) {
          expect(e.code).toBe("CERT_HAS_EXPIRED");
        }
      }),
    );
  });
});

it("fetch with checkServerIdentity failing should throw", async () => {
  try {
    await fetch(`https://example.com`, {
      keepalive: false,
      tls: {
        checkServerIdentity() {
          return new Error("CustomError");
        },
      },
    }).then((res: Response) => res.blob());

    expect.unreachable();
  } catch (e: any) {
    expect(e.message).toBe("CustomError");
  }
});

it("fetch with self-sign certificate tls + rejectUnauthorized: false should not throw", async () => {
  await createServer(CERT_LOCALHOST_IP, async port => {
    const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
    await Promise.all(
      urls.map(async url => {
        try {
          const result = await fetch(url, { tls: { rejectUnauthorized: false } }).then((res: Response) => res.text());
          expect(result).toBe("Hello World");
        } catch {
          expect.unreachable();
        }
      }),
    );
  });
});

it("fetch with invalid tls + rejectUnauthorized: false should not throw", async () => {
  await createServer(CERT_EXPIRED, async port => {
    const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
    await Promise.all(
      urls.map(async url => {
        try {
          const result = await fetch(url, { tls: { rejectUnauthorized: false } }).then((res: Response) => res.text());
          expect(result).toBe("Hello World");
        } catch {
          expect.unreachable();
        }
      }),
    );
  });
});

it("fetch should respect rejectUnauthorized env", async () => {
  await createServer(CERT_EXPIRED, async port => {
    const url = `https://localhost:${port}`;

    const promises = [];
    for (let i = 0; i < 2; i++) {
      const proc = Bun.spawn({
        env: {
          ...bunEnv,
          SERVER: url,
          NODE_TLS_REJECT_UNAUTHORIZED: i.toString(),
        },
        stderr: "inherit",
        stdout: "inherit",
        stdin: "inherit",
        cmd: [bunExe(), join(import.meta.dir, "fetch-reject-authorized-env-fixture.js")],
      });

      promises.push(proc.exited);
    }

    const [exitCode1, exitCode2] = await Promise.all(promises);
    expect(exitCode1).toBe(0);
    expect(exitCode2).toBe(1);
  });
});
