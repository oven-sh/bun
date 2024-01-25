import { it, expect } from "bun:test";
import tls from "tls";
import { join } from "node:path";
import { bunEnv, bunExe } from "harness";

type TLSOptions = {
  cert: string;
  key: string;
  passphrase?: string;
};

const CERT_LOCALHOST_IP: TLSOptions = {
  "cert":
    "-----BEGIN CERTIFICATE-----\nMIIDrzCCApegAwIBAgIUHaenuNcUAu0tjDZGpc7fK4EX78gwDQYJKoZIhvcNAQEL\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yMzA5MDYyMzI3MzRaFw0yNTA5MDUyMzI3MzRaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+7odzr3yI\nYewRNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MB\nKw3rl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwP\ndwVUeR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn\n0oH9HbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOF\nzDpcp1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FU\nIDHtnUsoHX3RAgMBAAGjTzBNMCwGA1UdEQQlMCOCCWxvY2FsaG9zdIcEfwAAAYcQ\nAAAAAAAAAAAAAAAAAAAAATAdBgNVHQ4EFgQUF3y/su4J/8ScpK+rM2LwTct6EQow\nDQYJKoZIhvcNAQELBQADggEBAGWGWp59Bmrk3Gt0bidFLEbvlOgGPWCT9ZrJUjgc\nhY44E+/t4gIBdoKOSwxo1tjtz7WsC2IYReLTXh1vTsgEitk0Bf4y7P40+pBwwZwK\naeIF9+PC6ZoAkXGFRoyEalaPVQDBg/DPOMRG9OH0lKfen9OGkZxmmjRLJzbyfAhU\noI/hExIjV8vehcvaJXmkfybJDYOYkN4BCNqPQHNf87ZNdFCb9Zgxwp/Ou+47J5k4\n5plQ+K7trfKXG3ABMbOJXNt1b0sH8jnpAsyHY4DLEQqxKYADbXsr3YX/yy6c0eOo\nX2bHGD1+zGsb7lGyNyoZrCZ0233glrEM4UxmvldBcWwOWfk=\n-----END CERTIFICATE-----\n",
  "key":
    "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC+7odzr3yIYewR\nNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MBKw3r\nl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwPdwVU\neR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn0oH9\nHbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOFzDpc\np1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FUIDHt\nnUsoHX3RAgMBAAECggEAAckMqkn+ER3c7YMsKRLc5bUE9ELe+ftUwfA6G+oXVorn\nE+uWCXGdNqI+TOZkQpurQBWn9IzTwv19QY+H740cxo0ozZVSPE4v4czIilv9XlVw\n3YCNa2uMxeqp76WMbz1xEhaFEgn6ASTVf3hxYJYKM0ljhPX8Vb8wWwlLONxr4w4X\nOnQAB5QE7i7LVRsQIpWKnGsALePeQjzhzUZDhz0UnTyGU6GfC+V+hN3RkC34A8oK\njR3/Wsjahev0Rpb+9Pbu3SgTrZTtQ+srlRrEsDG0wVqxkIk9ueSMOHlEtQ7zYZsk\nlX59Bb8LHNGQD5o+H1EDaC6OCsgzUAAJtDRZsPiZEQKBgQDs+YtVsc9RDMoC0x2y\nlVnP6IUDXt+2UXndZfJI3YS+wsfxiEkgK7G3AhjgB+C+DKEJzptVxP+212hHnXgr\n1gfW/x4g7OWBu4IxFmZ2J/Ojor+prhHJdCvD0VqnMzauzqLTe92aexiexXQGm+WW\nwRl3YZLmkft3rzs3ZPhc1G2X9QKBgQDOQq3rrxcvxSYaDZAb+6B/H7ZE4natMCiz\nLx/cWT8n+/CrJI2v3kDfdPl9yyXIOGrsqFgR3uhiUJnz+oeZFFHfYpslb8KvimHx\nKI+qcVDcprmYyXj2Lrf3fvj4pKorc+8TgOBDUpXIFhFDyM+0DmHLfq+7UqvjU9Hs\nkjER7baQ7QKBgQDTh508jU/FxWi9RL4Jnw9gaunwrEt9bxUc79dp+3J25V+c1k6Q\nDPDBr3mM4PtYKeXF30sBMKwiBf3rj0CpwI+W9ntqYIwtVbdNIfWsGtV8h9YWHG98\nJ9q5HLOS9EAnogPuS27walj7wL1k+NvjydJ1of+DGWQi3aQ6OkMIegap0QKBgBlR\nzCHLa5A8plG6an9U4z3Xubs5BZJ6//QHC+Uzu3IAFmob4Zy+Lr5/kITlpCyw6EdG\n3xDKiUJQXKW7kluzR92hMCRnVMHRvfYpoYEtydxcRxo/WS73SzQBjTSQmicdYzLE\ntkLtZ1+ZfeMRSpXy0gR198KKAnm0d2eQBqAJy0h9AoGBAM80zkd+LehBKq87Zoh7\ndtREVWslRD1C5HvFcAxYxBybcKzVpL89jIRGKB8SoZkF7edzhqvVzAMP0FFsEgCh\naClYGtO+uo+B91+5v2CCqowRJUGfbFOtCuSPR7+B3LDK8pkjK2SQ0mFPUfRA5z0z\nNVWtC0EYNBTRkqhYtqr3ZpUc\n-----END PRIVATE KEY-----\n",
};
const CERT_EXPIRED: TLSOptions = {
  cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
  passphrase: "1234",
};

async function createServer(cert: TLSOptions, callback: (port: number) => Promise<any>) {
  const server = Bun.serve({
    port: 0,
    tls: cert,
    fetch() {
      return new Response("Hello World");
    },
  });
  try {
    await callback(server.port);
  } finally {
    server.stop(true);
  }
}

it("can handle multiple requests with non native checkServerIdentity", async () => {
  async function request() {
    try {
      const result = await fetch(`https://www.example.com`, {
        keepalive: false,
        tls: { checkServerIdentity: tls.checkServerIdentity },
      }).then((res: Response) => res.text());
      expect(result?.length).toBeGreaterThan(0);
    } catch (e: any) {
      expect.unreachable();
    }
  }
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(request());
  }
  await Promise.all(promises);
});

it("fetch with valid tls should not throw", async () => {
  const urls = [`https://bun.sh`, `https://www.example.com`];
  for (const url of urls) {
    const result = await fetch(url, { keepalive: false }).then((res: Response) => res.text());
    expect(result?.length).toBeGreaterThan(0);
  }
});

it("fetch with valid tls and non-native checkServerIdentity should work", async () => {
  const urls = [`https://bun.sh`, `https://www.example.com`];
  var count = 0;
  for (const url of urls) {
    await fetch(url, {
      keepalive: false,
      tls: {
        checkServerIdentity(hostname: string, cert: any) {
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
  var count = 0;

  await fetch(`https://bun.sh`, {
    keepalive: false,
    tls: {
      rejectUnauthorized: false,
      checkServerIdentity(hostname: string, cert: any) {
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
      } catch (e: any) {
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
      } catch (e: any) {
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
