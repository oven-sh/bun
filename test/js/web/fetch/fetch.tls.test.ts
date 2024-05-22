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
    }).then((res: Response) => res.text());
    expect(result?.length).toBeGreaterThan(0);
    expect(called).toBe(true);
  }
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(request());
  }
  await Promise.all(promises);
});

it("fetch with valid tls should not throw", async () => {
  const urls = ["https://bun.sh", "https://www.example.com"];
  for (const url of urls) {
    const result = await fetch(url, { keepalive: false }).then((res: Response) => res.text());
    expect(result?.length).toBeGreaterThan(0);
  }
});

it("fetch with valid tls and non-native checkServerIdentity should work", async () => {
  const urls = [`https://bun.sh`, `https://www.example.com`];
  let count = 0;
  for (const url of urls) {
    await fetch(url, {
      keepalive: false,
      tls: {
        checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
          count++;
          expect(["bun.sh", "www.example.com"]).toContain(hostname);
          return tls.checkServerIdentity(hostname, cert);
        },
      },
    }).then((res: Response) => res.text());
  }
  expect(count).toBe(2);
});

it("fetch with rejectUnauthorized: false should not call checkServerIdentity", async () => {
  let count = 0;

  await fetch("https://bun.sh", {
    keepalive: false,
    tls: {
      rejectUnauthorized: false,
      checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
        count++;
        return tls.checkServerIdentity(hostname, cert);
      },
    },
  }).then((res: Response) => res.text());
  expect(count).toBe(0);
});

it("fetch with self-sign tls should throw", async () => {
  await createServer(CERT_LOCALHOST_IP, async port => {
    const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
    for (const url of urls) {
      try {
        await fetch(url).then((res: Response) => res.text());
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      }
    }
  });
});

it("fetch with invalid tls should throw", async () => {
  await createServer(CERT_EXPIRED, async port => {
    const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
    for (const url of urls) {
      try {
        await fetch(url).then((res: Response) => res.text());
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("CERT_HAS_EXPIRED");
      }
    }
  });
});

it("fetch with checkServerIdentity failing should throw", async () => {
  try {
    await fetch(`https://bun.sh`, {
      keepalive: false,
      tls: {
        checkServerIdentity() {
          return new Error("CustomError");
        },
      },
    }).then((res: Response) => res.text());

    expect.unreachable();
  } catch (e: any) {
    expect(e.message).toBe("CustomError");
  }
});

it("fetch with self-sign certificate tls + rejectUnauthorized: false should not throw", async () => {
  await createServer(CERT_LOCALHOST_IP, async port => {
    const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
    for (const url of urls) {
      try {
        const result = await fetch(url, { tls: { rejectUnauthorized: false } }).then((res: Response) => res.text());
        expect(result).toBe("Hello World");
      } catch {
        expect.unreachable();
      }
    }
  });
});

it("fetch with invalid tls + rejectUnauthorized: false should not throw", async () => {
  await createServer(CERT_EXPIRED, async port => {
    const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
    for (const url of urls) {
      try {
        const result = await fetch(url, { tls: { rejectUnauthorized: false } }).then((res: Response) => res.text());
        expect(result).toBe("Hello World");
      } catch {
        expect.unreachable();
      }
    }
  });
});

it("fetch should respect rejectUnauthorized env", async () => {
  await createServer(CERT_EXPIRED, async port => {
    const url = `https://localhost:${port}`;

    for (let i = 0; i < 2; i++) {
      const proc = Bun.spawn({
        env: {
          ...bunEnv,
          SERVER: url,
          NODE_TLS_REJECT_UNAUTHORIZED: i.toString(),
        },
        stderr: "inherit",
        stdout: "inherit",
        cmd: [bunExe(), join(import.meta.dir, "fetch-reject-authorized-env-fixture.js")],
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(i);
    }
  });
});
