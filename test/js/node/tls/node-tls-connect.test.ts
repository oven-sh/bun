import { TLSSocket, connect } from "tls";

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
    expect(cert.subject.CN).toBe("bun.sh");
    expect(cert.issuer).toBeDefined();
    expect(cert.issuer.C).toBe("US");
    expect(cert.issuer.O).toBe("Google Trust Services LLC");
    expect(cert.issuer.CN).toBe("GTS CA 1P5");
    expect(cert.subjectaltname).toBe("DNS:bun.sh, DNS:*.bun.sh");
    expect(cert.infoAccess).toBeDefined();

    const infoAccess = cert.infoAccess as NodeJS.Dict<string[]>;
    expect(infoAccess["OCSP - URI"]).toBeDefined();
    expect(infoAccess["CA Issuers - URI"]).toBeDefined();
    expect(cert.ca).toBeFalse();
    expect(cert.bits).toBeNumber();
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

    // expect(socket.getFinished()).toBeInstanceOf(Buffer);
    // expect(socket.getPeerFinished()).toBeInstanceOf(Buffer);
  } finally {
    socket.end();
  }
});
