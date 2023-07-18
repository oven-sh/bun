import tls, { TLSSocket, connect, checkServerIdentity } from "tls";

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
    expect(cert.bits).toBe(2048);
    expect(cert.modulus).toBe(
      "A9F58B9925E08DD3393E4A5DFDBFD249A21C33AF0F38624FAF20D39EB3AC78400789CF3FCBE8C3B18B1F03B3C96B2455D88A60A8D7B2112D35159DB39A592624545CE52E6184D0504D59E6C81DD1025526DEBA547D89A47F16830AC55929C80888F65066D29517905DB1C7E8446580DC439D715C4452D03A97BB0DBC82970C8A3F7E8ABADBBA30FBF6475E2D1783793A4AC60BC57EF5E945C976CE54EECB4A3DA7920AC5C711D5FC8D6A235EFC7FA4024F3930EDDDD1680E6AEA9BD50C89394018761187B4838B07D70BF10E28E4A62F8E2FC4998BC3B9189CD50F61693D79FF761E2D4DEB3998578A6D6015926F60A4172125255FAD01485513DC3C1AE082EF",
    );
    expect(cert.exponent).toBe("0x10001");
    expect(cert.pubkey).toBeInstanceOf(Buffer);
    expect(cert.valid_from).toBe("Jun  1 01:36:52 2023 GMT"); // yes this space is intentional
    expect(cert.valid_to).toBe("Aug 30 01:36:51 2023 GMT");
    expect(cert.fingerprint).toBe("41:66:63:69:DC:31:95:B6:89:7C:54:72:80:19:EA:58:EE:26:FC:FA");
    expect(cert.fingerprint256).toBe(
      "51:5D:10:ED:F9:F1:71:9C:03:EB:1D:17:37:2E:B0:CE:CA:8E:E7:E2:D7:D9:F0:9F:25:8D:4C:30:61:FE:86:3A",
    );
    expect(cert.fingerprint512).toBe(
      "61:C6:22:B6:19:B6:28:EC:5E:B1:B5:C7:A2:45:3B:A6:BA:D6:1D:A6:96:28:07:47:04:3B:04:3A:2D:A1:D7:8E:C4:55:83:B9:11:7F:6C:3B:EB:5A:66:C5:CC:E0:44:E8:4F:F1:6C:16:14:03:5B:71:76:F9:42:0C:04:5F:C0:F1",
    );
    expect(cert.serialNumber).toBe("03E071FE809E66081139F0BDD02AC346");
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
