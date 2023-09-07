import tls, { TLSSocket, connect, checkServerIdentity, createServer, Server } from "tls";
import { join } from "path";
import { AddressInfo } from "ws";

it("should work with alpnProtocols", done => {
  try {
    let socket: TLSSocket | null = connect({
      ALPNProtocols: ["http/1.1"],
      host: "bun.sh",
      servername: "bun.sh",
      port: 443,
      rejectUnauthorized: false,
    });

    const timeout = setTimeout(() => {
      socket?.end();
      done("timeout");
    }, 3000);

    socket.on("error", err => {
      clearTimeout(timeout);
      done(err);
    });

    socket.on("secureConnect", () => {
      clearTimeout(timeout);
      done(socket?.alpnProtocol === "http/1.1" ? undefined : "alpnProtocol is not http/1.1");
      socket?.end();
      socket = null;
    });
  } catch (err) {
    done(err);
  }
});

const COMMON_CERT = {
  cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
  passphrase: "1234",
};

it("Bun.serve() should work with tls and Bun.file()", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(Bun.file(join(import.meta.dir, "fixtures/index.html")));
    },
    tls: {
      cert: COMMON_CERT.cert,
      key: COMMON_CERT.key,
    },
  });
  const res = await fetch(`https://${server.hostname}:${server.port}/`, { tls: { rejectUnauthorized: false } });
  expect(await res.text()).toBe("<h1>HELLO</h1>");
  server.stop();
});

it("should have peer certificate when using self asign certificate", async () => {
  const server = Bun.serve({
    tls: {
      cert: COMMON_CERT.cert,
      key: COMMON_CERT.key,
      passphrase: COMMON_CERT.passphrase,
    },
    port: 0,
    fetch() {
      return new Response("Hello World");
    },
  });

  const { promise: socketPromise, resolve: resolveSocket, reject: rejectSocket } = Promise.withResolvers();
  const socket = connect(
    {
      ALPNProtocols: ["http/1.1"],
      host: server.hostname,
      servername: "localhost",
      port: server.port,
      rejectUnauthorized: false,
      requestCert: true,
    },
    resolveSocket,
  ).on("error", rejectSocket);

  await socketPromise;

  try {
    expect(socket).toBeDefined();
    const cert = socket.getPeerCertificate();
    expect(cert).toBeDefined();
    expect(cert.subject).toMatchObject({
      C: "AU",
      ST: "Some-State",
      O: "Internet Widgits Pty Ltd",
    });
    expect(cert.issuer).toBeDefined();
    expect(cert.issuer).toMatchObject({
      C: "AU",
      ST: "Some-State",
      O: "Internet Widgits Pty Ltd",
    });
    expect(cert.subjectaltname).toBeUndefined();
    expect(cert.infoAccess).toBeUndefined();
    expect(cert.ca).toBeTrue();
    expect(cert.bits).toBe(2048);
    expect(cert.modulus).toBe(
      "EE2EC82047480938924D5C7E99AEB11F13AD71B77AC065B79E4C650A427552E57C366639A2F32C1A718384926D510DA3E6283905C2547F7B5ECEA08D5B8B4A9D23A048849F1002AFA67D813EF685AB7CB1D988F3D2BBAF7062A90CC6415E607F000B46C8DFD4157CE4ADC7E9A662C72536816061BA2A7994E3780F9120F2E22C38E8224550EBA9739D40148CFB46C13B99B4F5A6508CF1EEF981FA9A6529F693E5A6CBEF27D471B2607855212455BCFAA44BB8152D254475379A52D28FD55C7FF35F3F1C35A4DE822F0D5588F42147EF77A5371064307E7302B48D2014DE85D9DE87201EBE363845A0BF90AF2BB253B77B812D27D4A7038B303A30A2A8021013",
    );
    expect(cert.exponent).toBe("0x10001");
    expect(cert.pubkey).toBeInstanceOf(Buffer);
    expect(cert.valid_from).toBe("Feb  3 14:49:35 2019 GMT"); // yes this space is intentional
    expect(cert.valid_to).toBe("Feb  3 14:49:35 2020 GMT");
    expect(cert.fingerprint).toBe("48:5F:4B:DB:FD:56:50:32:F0:27:84:3C:3F:B9:6C:DB:13:42:D2:D4");
    expect(cert.fingerprint256).toBe(
      "40:F9:8C:B8:9D:3C:0D:93:09:C4:A7:96:B8:A4:69:03:6C:DB:1B:83:C9:0E:76:AE:4A:F4:16:1A:A6:13:50:B2",
    );
    expect(cert.fingerprint512).toBe(
      "98:56:9F:C0:A7:21:AD:BE:F3:11:AD:78:17:61:7C:36:AE:85:AB:AC:9E:1E:BF:AA:F2:92:0D:8B:36:50:07:CF:7B:C3:16:19:0F:1F:B9:09:C9:45:9D:EC:C9:44:66:72:EE:EA:CF:74:23:13:B5:FB:E1:88:52:51:D2:C6:B6:4D",
    );
    expect(cert.serialNumber).toBe("A2DD4153F2F748E3");
    expect(cert.raw).toBeInstanceOf(Buffer);
  } finally {
    server.stop();
    socket.end();
  }
});

it("should have peer certificate", async () => {
  const socket = (await new Promise((resolve, reject) => {
    const instance = connect(
      {
        ALPNProtocols: ["http/1.1"],
        host: "bun.sh",
        servername: "bun.sh",
        port: 443,
        rejectUnauthorized: false,
        requestCert: true,
      },
      function () {
        resolve(instance);
      },
    ).on("error", reject);
  })) as TLSSocket;

  try {
    expect(socket).toBeDefined();
    const cert = socket.getPeerCertificate();
    expect(cert).toBeDefined();
    expect(cert.subject).toBeDefined();
    // this should never change
    expect(cert.subject.CN).toBe("bun.sh");
    expect(cert.subjectaltname).toContain("DNS:bun.sh");
    expect(cert.infoAccess).toBeDefined();
    // we just check the types this can change over time
    const infoAccess = cert.infoAccess as NodeJS.Dict<string[]>;
    expect(infoAccess["OCSP - URI"]).toBeDefined();
    expect(infoAccess["CA Issuers - URI"]).toBeDefined();
    expect(cert.ca).toBeFalse();
    expect(cert.bits).toBe(2048);
    expect(typeof cert.modulus).toBe("string");
    expect(typeof cert.exponent).toBe("string");
    expect(cert.pubkey).toBeInstanceOf(Buffer);
    expect(typeof cert.valid_from).toBe("string");
    expect(typeof cert.valid_to).toBe("string");
    expect(typeof cert.fingerprint).toBe("string");
    expect(typeof cert.fingerprint256).toBe("string");
    expect(typeof cert.fingerprint512).toBe("string");
    expect(typeof cert.serialNumber).toBe("string");
    expect(cert.raw).toBeInstanceOf(Buffer);
  } finally {
    socket.end();
  }
});

it("getCipher, getProtocol, getEphemeralKeyInfo, getSharedSigalgs, getSession, exportKeyingMaterial and isSessionReused should work", async () => {
  const socket = (await new Promise((resolve, reject) => {
    connect({
      ALPNProtocols: ["http/1.1"],
      host: "bun.sh",
      servername: "bun.sh",
      port: 443,
      rejectUnauthorized: false,
      requestCert: true,
    })
      .on("secure", resolve)
      .on("error", reject);
  })) as TLSSocket;

  try {
    expect(socket.getCipher()).toMatchObject({
      name: "TLS_AES_128_GCM_SHA256",
      standardName: "TLS_AES_128_GCM_SHA256",
      version: "TLSv1/SSLv3",
    });
    expect(socket.getProtocol()).toBe("TLSv1.3");
    expect(typeof socket.getEphemeralKeyInfo()).toBe("object");
    expect(socket.getSharedSigalgs()).toBeInstanceOf(Array);
    expect(socket.getSession()).toBeInstanceOf(Buffer);
    expect(socket.exportKeyingMaterial(512, "client finished")).toBeInstanceOf(Buffer);
    expect(socket.isSessionReused()).toBe(false);

    // BoringSSL does not support these methods for >= TLSv1.3
    expect(socket.getFinished()).toBeUndefined();
    expect(socket.getPeerFinished()).toBeUndefined();
  } finally {
    socket.end();
  }
});

it("should have checkServerIdentity", async () => {
  expect(checkServerIdentity).toBeFunction();
  expect(tls.checkServerIdentity).toBeFunction();
});
