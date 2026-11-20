import { describe, expect, test } from "bun:test";
import { X509Certificate, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { connect, createServer, rootCertificates, type PeerCertificate, type TLSSocket } from "node:tls";

// Self-signed, valid until 2126. Subject CN=wildcard-san.example.com,
// subjectAltName: DNS:*.wildcard.example.com, DNS:exact.example.com
const wildcardSanCertPem = `-----BEGIN CERTIFICATE-----
MIIDKDCCAhCgAwIBAgIBATANBgkqhkiG9w0BAQsFADAjMSEwHwYDVQQDDBh3aWxk
Y2FyZC1zYW4uZXhhbXBsZS5jb20wIBcNMjYwNzAzMDY1MDAxWhgPMjEyNjA2MDkw
NjUwMDFaMCMxITAfBgNVBAMMGHdpbGRjYXJkLXNhbi5leGFtcGxlLmNvbTCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMEOoI3qCSq9CdlwWhHFf8xdUbhC
jp0MCgmRKqJh0JppBPykV808jOZeyZpFvtE3wM68YwsrVSwqrZgrClEb0GzYIpFI
Mxo5YoCIOluU6EL7ll/z7WyJ0SyfnSRt5braMXP3UQXYWv5XwDBFu1gXX6oC6o0S
0SJZTo4qg0agS9g17f1TmyUYA4wNDmEPS2hN6p3J+2uEIZE4GqxLgkvv8ON4iC2m
3/8xB5qGnZA+IT3f0dWC4IcMSeXSiWGyuEA+6/Otn/Iz073bOXAFkhv9DwXZca0O
YI6ecmwAFDjH6hBgX3jjwZL6Os1AZ/w9vLlb7vxEvdg9YiDEi/Io8sInkzcCAwEA
AaNlMGMwDAYDVR0TAQH/BAIwADA0BgNVHREELTArghYqLndpbGRjYXJkLmV4YW1w
bGUuY29tghFleGFjdC5leGFtcGxlLmNvbTAdBgNVHQ4EFgQUXkMY5bxwAaEAOtb7
v8++jiYQvbswDQYJKoZIhvcNAQELBQADggEBAKTfuXjBbtAvFyk2+pdqMzcQJlDl
eu1N06IvkTip0/Z0CKeRstkrqqmcspeHss7l/bnWXT83wUsZ2OJAM2dAxG7IsOPU
fsGlO6BSvzzPfsA/sGpxNxWitXtQAjGRDSw12xQ+KAgG3Outyc2aPeEkzcVV2SBm
o5JV0Big7OjvV0VQhN/6lrqSSknx0ZC2nV8GtWwew/mQP+MsuHsrmNTirH+raXBl
fzCNBW+YrUHAgV7gxvsqtld5sp+AA6rO9SO4kOCeXwxnJhxIafI8D2tZqNUf04LW
xoF/4xgOUMNvA8O5H/sm5QwghflFqkpuvqdeYHLNzb0yWUvPvtTfYiA7+vo=
-----END CERTIFICATE-----
`;

// CN=agent1, no subjectAltName, so the subject is the only thing to match against.
const cnOnlyCertPem = readFileSync(path.join(import.meta.dir, "..", "test", "fixtures", "keys", "agent1-cert.pem"));

// Self-signed, CN=emptysan.test. The subjectAltName extension is present but holds an empty
// GeneralNames SEQUENCE, so the extension prints as the empty string.
const emptySanCertPem = `-----BEGIN CERTIFICATE-----
MIIBLDCB0qADAgECAgEJMAoGCCqGSM49BAMCMBgxFjAUBgNVBAMMDWVtcHR5c2Fu
LnRlc3QwHhcNMjQwMTAxMDAwMDAwWhcNMzQwMTAxMDAwMDAwWjAYMRYwFAYDVQQD
DA1lbXB0eXNhbi50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERZd4TI3L
9hB6mAqrzlK/lZtnTN1HQRh8noNVV9rHms6RFBhYp/mSU2JrMPIEGB8DP4YEnoin
Og/IJjctZ/WG6qMNMAswCQYDVR0RBAIwADAKBggqhkjOPQQDAgNJADBGAiEAlvDe
VqtVe0NtY8U5uwa7lqNLtkqjXClGQl4fgCV4KloCIQCwni1CVvWLJa0cZm3BQtwH
lGNHf1nq+j8dNaMGmheHKQ==
-----END CERTIFICATE-----
`;

// Self-signed, brainpoolP256r1 key (a curve BoringSSL does not support, so publicKey cannot be decoded).
const brainpoolCertPem = `-----BEGIN CERTIFICATE-----
MIIBfTCCASSgAwIBAgIUbtq88KPedDaNbLVSO/txNjRWPicwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJYnJhaW5wb29sMB4XDTI2MDgyMzIwMDAyMVoXDTM2MDgyMDIw
MDAyMVowFDESMBAGA1UEAwwJYnJhaW5wb29sMFowFAYHKoZIzj0CAQYJKyQDAwII
AQEHA0IABG8tl/XkdDFsqeIkd03yEF82Ivy1xzmsN8/NekZJzuwDSLlCCIbX2k6z
JUoTfqdTxRL4ccrI4cXpqDxZPPaywMOjUzBRMB0GA1UdDgQWBBRpnrKAVW6DXXNk
BABmxqGZ3WvcPDAfBgNVHSMEGDAWgBRpnrKAVW6DXXNkBABmxqGZ3WvcPDAPBgNV
HRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIBssqQu642CLwl1dfD7WoD0D
qGl/+1Di3abpA8YZOtoyAiAiScaiKhxu48bWQXYW5ZoQNzAfBIwL4krTuLVAKYZc
Vg==
-----END CERTIFICATE-----`;

describe("new X509Certificate()", () => {
  test.each([
    ["nothing", [], "Received undefined"],
    ["null", [null], "Received null"],
    ["a number", [5], "Received type number (5)"],
    ["an object", [{}], "Received an instance of Object"],
  ])("with %s", (_, args, received) => {
    expect(() => new (X509Certificate as any)(...args)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "buffer" argument must be of type string or an instance of Buffer, TypedArray, or DataView. ${received}`,
      }),
    );
  });

  test("with a PEM that starts with a byte order mark", () => {
    const pem = readFileSync(path.join(import.meta.dir, "..", "test", "fixtures", "keys", "agent1-cert.pem"), "utf8");
    expect(new X509Certificate("\ufeff" + pem).fingerprint256).toBe(new X509Certificate(pem).fingerprint256);
  });

  test("with a detached view, which is empty", () => {
    const view = new Uint8Array(4);
    view.buffer.transfer();
    expect(() => new X509Certificate(view)).toThrow(expect.objectContaining({ name: "Error" }));
  });

  test.each([
    ["text", "nope", "NO_START_LINE"],
    ["nothing", "", "NO_START_LINE"],
    ["other DER", Buffer.from("3003020101", "hex"), "NO_START_LINE"],
    ["bad base64", "-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----\n", "BAD_BASE64_DECODE"],
  ])("with %s, which is not a certificate", (_, input, reason) => {
    expect(() => new X509Certificate(input)).toThrow(
      expect.objectContaining({ name: "Error", code: `ERR_OSSL_PEM_${reason}`, library: "PEM routines", reason }),
    );
  });
});

describe("the arguments of", () => {
  const cert = new X509Certificate(cnOnlyCertPem);
  const invalidType = (message: string) =>
    expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
  const received = [
    [undefined, "Received undefined"],
    [null, "Received null"],
    [5, "Received type number (5)"],
    [{}, "Received an instance of Object"],
    [Buffer.from("agent1"), "Received an instance of Buffer"],
  ] as const;
  const checks = [
    ["checkHost", "name", "agent1"],
    ["checkEmail", "email", "ry@tinyclouds.org"],
    ["checkIP", "ip", "127.0.0.1"],
  ] as const;

  test.each(checks)("%s(): a string", (method, name) => {
    for (const [value, text] of received) {
      expect(() => (cert as any)[method](value)).toThrow(
        invalidType(`The "${name}" argument must be of type string. ${text}`),
      );
    }
  });

  test.each(checks)("%s(): options", (method, _, good) => {
    const call = (options: unknown) => () => (cert as any)[method](good, options);
    for (const [options, text] of [
      [null, "Received null"],
      [5, "Received type number (5)"],
      ["x", "Received type string ('x')"],
      [[], "Received an instance of Array"],
      [function f() {}, "Received function f"],
    ]) {
      expect(call(options)).toThrow(invalidType(`The "options" argument must be of type object. ${text}`));
    }
    expect(call({ subject: 5 })).toThrow(
      invalidType('The "options.subject" property must be of type string. Received type number (5)'),
    );
    expect(call({ subject: "nope" })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: "The property 'options.subject' is invalid. Received 'nope'",
      }),
    );
    for (const name of ["wildcards", "partialWildcards", "multiLabelWildcards", "singleLabelSubdomains"]) {
      // The types are checked before the value of `subject`.
      expect(call({ subject: "nope", [name]: 1 })).toThrow(
        invalidType(`The "options.${name}" property must be of type boolean. Received type number (1)`),
      );
    }
    for (const options of [undefined, {}, { subject: "default" }, { subject: undefined, wildcards: undefined }]) {
      expect(call(options)).not.toThrow();
    }
    expect((cert as any)[method]).toHaveLength(2);
  });

  test.each(checks)("%s(): only the own enumerable properties of options", (method, _, good) => {
    for (const options of [
      Object.create({ subject: "nope", wildcards: 1 }),
      Object.defineProperty({}, "subject", { value: "nope" }),
      new (class {
        get subject() {
          return "nope";
        }
      })(),
    ]) {
      expect(() => (cert as any)[method](good, options)).not.toThrow();
    }
  });

  test("checkHost(): an inherited `subject` is not an option", () => {
    expect(cert.checkHost("agent1", { subject: "never" })).toBeUndefined();
    expect(cert.checkHost("agent1", Object.create({ subject: "never" }))).toBe("agent1");
  });

  test("checkHost(), checkEmail() and checkIP(): a name that cannot be one", () => {
    const invalid = expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
      message: "Invalid name",
    });
    expect(() => cert.checkHost("a\0b")).toThrow(invalid);
    expect(() => cert.checkEmail("a\0b")).toThrow(invalid);
    expect(() => cert.checkIP("agent1")).toThrow(invalid);
    expect(() => cert.checkIP("")).toThrow(invalid);
    expect(cert.checkHost("")).toBeUndefined();
    expect(cert.checkEmail("")).toBeUndefined();
  });

  test("checkIssued(), checkPrivateKey() and verify()", () => {
    for (const [value, text] of received) {
      expect(() => cert.checkIssued(value as any)).toThrow(
        invalidType(`The "otherCert" argument must be an instance of X509Certificate. ${text}`),
      );
      for (const method of ["checkPrivateKey", "verify"] as const) {
        expect(() => cert[method](value as any)).toThrow(
          invalidType(`The "pkey" argument must be an instance of KeyObject. ${text}`),
        );
      }
    }
  });
});

describe("X509Certificate validity", () => {
  const length = (n: number) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
  const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag, ...length(body.length)]), body]);
  const element = (der: Buffer, offset: number) => {
    let size = der[offset + 1];
    let header = 2;
    if (size & 0x80) {
      header += size & 0x7f;
      size = der.readUIntBE(offset + 2, size & 0x7f);
    }
    return { start: offset + header, end: offset + header + size };
  };
  // Swaps the validity of a DER certificate. `new X509Certificate()` does not look at the signature.
  function withValidity(der: Buffer, from: string, to: string) {
    const outer = element(der, 0);
    const tbs = element(der, outer.start);
    const fields: Buffer[] = [];
    for (let offset = tbs.start; offset < tbs.end;) {
      const { end } = element(der, offset);
      fields.push(der.subarray(offset, end));
      offset = end;
    }
    // A GeneralizedTime is 15 bytes. A UTCTime is 13 bytes, or 17 with a "+hhmm" offset.
    const time = (text: string) => tlv(text.length === 15 ? 0x18 : 0x17, Buffer.from(text));
    fields[4] = tlv(0x30, Buffer.concat([time(from), time(to)]));
    return tlv(0x30, Buffer.concat([tlv(0x30, Buffer.concat(fields)), der.subarray(tbs.end, outer.end)]));
  }
  const { raw } = new X509Certificate(cnOnlyCertPem);

  test.each([
    ["00000101000000Z", "00010101000000Z", "0000-01-01T00:00:00.000Z", "0001-01-01T00:00:00.000Z"],
    ["00500101000000Z", "00991231235959Z", "0050-01-01T00:00:00.000Z", "0099-12-31T23:59:59.000Z"],
    ["01000101000000Z", "99991231235959Z", "0100-01-01T00:00:00.000Z", "9999-12-31T23:59:59.000Z"],
    ["500101000000Z", "491231235959Z", "1950-01-01T00:00:00.000Z", "2049-12-31T23:59:59.000Z"],
    ["19691231235959Z", "20380119031408Z", "1969-12-31T23:59:59.000Z", "2038-01-19T03:14:08.000Z"],
  ])("from %s to %s", (from, to, validFrom, validTo) => {
    const cert = new X509Certificate(withValidity(raw, from, to));
    expect(cert.validFromDate.toISOString()).toBe(validFrom);
    expect(cert.validToDate.toISOString()).toBe(validTo);
  });

  // RFC 5280 forbids a timezone offset in a validity time. BoringSSL's X509 parser and OpenSSL both
  // accept "YYMMDDHHMMSS+hhmm" / "-hhmm" in a UTCTime, and Node applies the offset.
  describe("as a UTCTime with a timezone offset", () => {
    // Every accessor of a validity. toJSON() is the ISO string, or null for an Invalid Date.
    const validity = (x509: X509Certificate) => {
      const legacy = x509.toLegacyObject();
      return {
        validFrom: x509.validFrom,
        valid_from: legacy.valid_from,
        validFromDate: x509.validFromDate.toJSON(),
        validTo: x509.validTo,
        valid_to: legacy.valid_to,
        validToDate: x509.validToDate.toJSON(),
      };
    };

    test.each([
      [
        "200101000000-0530",
        "301231235959+0100",
        ["Jan  1 05:30:00 2020 GMT", "2020-01-01T05:30:00.000Z"],
        ["Dec 31 22:59:59 2030 GMT", "2030-12-31T22:59:59.000Z"],
      ],
      [
        "200101000000+0000",
        "200101000000-0000",
        ["Jan  1 00:00:00 2020 GMT", "2020-01-01T00:00:00.000Z"],
        ["Jan  1 00:00:00 2020 GMT", "2020-01-01T00:00:00.000Z"],
      ],
      [
        "200101000000+1200",
        "200101000000-1200",
        ["Dec 31 12:00:00 2019 GMT", "2019-12-31T12:00:00.000Z"],
        ["Jan  1 12:00:00 2020 GMT", "2020-01-01T12:00:00.000Z"],
      ],
      [
        "200101000000+1259",
        "200101000000-1259",
        ["Dec 31 11:01:00 2019 GMT", "2019-12-31T11:01:00.000Z"],
        ["Jan  1 12:59:00 2020 GMT", "2020-01-01T12:59:00.000Z"],
      ],
      // The offset moves these two times out of the years that a UTCTime holds (1950-2049).
      [
        "491231235959-0100",
        "500101000000+0100",
        ["Jan  1 00:59:59 2050 GMT", "2050-01-01T00:59:59.000Z"],
        ["Dec 31 23:00:00 1949 GMT", "1949-12-31T23:00:00.000Z"],
      ],
    ])("from %s to %s is the time in GMT", (from, to, [validFrom, validFromDate], [validTo, validToDate]) => {
      const x509 = new X509Certificate(withValidity(raw, from, to));
      const expected = { validFrom, valid_from: validFrom, validFromDate, validTo, valid_to: validTo, validToDate };
      expect(validity(x509)).toEqual(expected);
      expect(validity(structuredClone(x509))).toEqual(expected);
    });

    // OpenSSL refuses an offset hour above 12, so Node has no time for these.
    test.each([
      ["200101000000+1300", "200101000000-1300"],
      ["200101000000+2359", "200101000000-2359"],
    ])("from %s to %s is a bad time", (from, to) => {
      expect(validity(new X509Certificate(withValidity(raw, from, to)))).toEqual({
        validFrom: "Bad time value",
        valid_from: "Bad time value",
        validFromDate: null,
        validTo: "Bad time value",
        valid_to: "Bad time value",
        validToDate: null,
      });
    });

    test("a bad notBefore does not change notAfter", () => {
      expect(validity(new X509Certificate(withValidity(raw, "200101000000+1300", "301231235959Z")))).toEqual({
        validFrom: "Bad time value",
        valid_from: "Bad time value",
        validFromDate: null,
        validTo: "Dec 31 23:59:59 2030 GMT",
        valid_to: "Dec 31 23:59:59 2030 GMT",
        validToDate: "2030-12-31T23:59:59.000Z",
      });
    });

    // Self-signed EC P-256 certificate, CN=localhost, from "200101000000-0530" to "301231235959+0100".
    // openssl does not write the offset form, so the TBSCertificate of an `openssl req -x509`
    // certificate was rebuilt with this validity and signed again with `key`.
    const cert = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUVlCjg2eA4PDTy99vuqiPfVXfhQ4wCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCYXETIwMDEwMTAwMDAwMC0wNTMwFxEzMDEy
MzEyMzU5NTkrMDEwMDAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAASzoiClaPOi2ZSUk0jCrlwc2214IIsIlD1FqaxxRK5gJNU2
mVAgAhdVErLTpbPYEOeN05B4h/AIGMIMn7TfFo4Qo2kwZzAdBgNVHQ4EFgQU08p9
IYJGwyx5RAyF/oU1rT7FyU8wHwYDVR0jBBgwFoAU08p9IYJGwyx5RAyF/oU1rT7F
yU8wDwYDVR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYIKoZI
zj0EAwIDSAAwRQIgZKUnc1MqfDu+NVUZUJwpg79J92P133xIvE5EvI2KhbsCIQC0
o5xAJFDUJCztalZEnJNOiwJTratQU3amSwINZggSFA==
-----END CERTIFICATE-----`;
    const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgtW4/jIJlViNFnoXq
T0MUuFw1SKC16xeV6bTAuVXo8AqhRANCAASzoiClaPOi2ZSUk0jCrlwc2214IIsI
lD1FqaxxRK5gJNU2mVAgAhdVErLTpbPYEOeN05B4h/AIGMIMn7TfFo4Q
-----END PRIVATE KEY-----`;

    test("in the certificates of a TLS connection", async () => {
      const server = createServer({ cert, key });
      let socket: TLSSocket | undefined, serverSocket: TLSSocket | undefined;
      try {
        await once(server.listen(0, "127.0.0.1"), "listening");
        const accepted = once(server, "secureConnection");
        const { port } = server.address() as AddressInfo;
        socket = connect({ host: "127.0.0.1", port, rejectUnauthorized: false });
        await once(socket, "secureConnect");
        [serverSocket] = await accepted;
        const peer = socket.getPeerCertificate();
        const own = serverSocket!.getCertificate() as PeerCertificate;

        const validFrom = "Jan  1 05:30:00 2020 GMT";
        const validTo = "Dec 31 22:59:59 2030 GMT";
        expect({
          getPeerCertificate: [peer.valid_from, peer.valid_to],
          getCertificate: [own.valid_from, own.valid_to],
          getPeerX509Certificate: validity(socket.getPeerX509Certificate()!),
        }).toEqual({
          getPeerCertificate: [validFrom, validTo],
          getCertificate: [validFrom, validTo],
          getPeerX509Certificate: {
            validFrom,
            valid_from: validFrom,
            validFromDate: "2020-01-01T05:30:00.000Z",
            validTo,
            valid_to: validTo,
            validToDate: "2030-12-31T22:59:59.000Z",
          },
        });
        // Only the text changes. The verifier refuses this self-signed certificate, with the code Node gives for it.
        expect({ authorized: socket.authorized, authorizationError: `${socket.authorizationError}` }).toEqual({
          authorized: false,
          authorizationError: "ERROR_IN_CERT_NOT_AFTER_FIELD",
        });
      } finally {
        socket?.destroy();
        serverSocket?.destroy();
        server.close();
      }
    });
  });
});

describe("the legacy infoAccess", () => {
  const fixture = (name: string) =>
    new X509Certificate(readFileSync(path.join(import.meta.dir, "..", "test", "fixtures", "x509-escaping", name)));

  test("holds the values, not how they were escaped", () => {
    expect(fixture("info-0-cert.pem").toLegacyObject().infoAccess).toEqual({
      "OCSP - URI": ["http://good.example.com/\nOCSP - URI:http://evil.example.com/"],
    });
    expect(fixture("info-1-cert.pem").toLegacyObject().infoAccess).toEqual({
      "CA Issuers - URI": ["http://ca.example.com/\nOCSP - URI:http://evil.example.com"],
      "OCSP - DNS": ["good.example.com\nOCSP - URI:http://ca.nodejs.org/ca.cert"],
    });
    expect(fixture("info-2-cert.pem").toLegacyObject().infoAccess).toEqual({
      "1.3.9999.12.34 - URI": ["http://ca.example.com/"],
    });
  });

  test("is the same in the certificates of a TLS connection", async () => {
    const directory = path.join(import.meta.dir, "..", "test", "fixtures", "x509-escaping");
    const cert = readFileSync(path.join(directory, "info-1-cert.pem"));
    const server = createServer({ key: readFileSync(path.join(directory, "server-key.pem")), cert });
    let socket: TLSSocket | undefined, serverSocket: TLSSocket | undefined;
    try {
      await once(server.listen(0), "listening");
      const accepted = once(server, "secureConnection");
      let checked: PeerCertificate | undefined;
      socket = connect({
        port: (server.address() as AddressInfo).port,
        ca: cert,
        servername: "example.com",
        checkServerIdentity: (_, peer) => void (checked = peer),
      });
      await once(socket, "secureConnect");
      [serverSocket] = await accepted;
      const infoAccess = {
        "CA Issuers - URI": ["http://ca.example.com/\nOCSP - URI:http://evil.example.com"],
        "OCSP - DNS": ["good.example.com\nOCSP - URI:http://ca.nodejs.org/ca.cert"],
      };
      expect({
        checkServerIdentity: checked?.infoAccess,
        getPeerCertificate: socket.getPeerCertificate().infoAccess,
        getCertificate: (serverSocket!.getCertificate() as PeerCertificate).infoAccess,
      }).toEqual({ checkServerIdentity: infoAccess, getPeerCertificate: infoAccess, getCertificate: infoAccess });
    } finally {
      socket?.destroy();
      serverSocket?.destroy();
      server.close();
    }
  });
});

describe("X509Certificate.checkHost()", () => {
  const cert = new X509Certificate(wildcardSanCertPem);
  const cnOnly = new X509Certificate(cnOnlyCertPem);

  test.each([
    ["sub.wildcard.example.com", "*.wildcard.example.com"],
    ["SUB.WILDCARD.EXAMPLE.COM", "*.wildcard.example.com"],
    ["exact.example.com", "exact.example.com"],
    ["EXACT.EXAMPLE.COM", "exact.example.com"],
  ])("%p returns the subjectAltName entry that matched", (host, matched) => {
    expect(cert.checkHost(host)).toBe(matched);
  });

  test.each([
    "a.b.wildcard.example.com", // wildcards match a single label by default
    "wildcard.example.com", // "*." requires at least one label
    "wildcard-san.example.com", // the subject CN is skipped when a SAN is present
    "nomatch.example.org",
  ])("%p does not match", host => {
    expect(cert.checkHost(host)).toBeUndefined();
  });

  test("wildcards: false only disables the wildcard entry", () => {
    expect(cert.checkHost("sub.wildcard.example.com", { wildcards: false })).toBeUndefined();
    expect(cert.checkHost("exact.example.com", { wildcards: false })).toBe("exact.example.com");
  });

  test.each(["agent1", "AGENT1", "AgEnT1"])("%p falls back to the subject CN and returns it", host => {
    expect(cnOnly.checkHost(host)).toBe("agent1");
  });

  test("subject: 'never' disables the subject CN fallback", () => {
    expect(cnOnly.checkHost("agent1", { subject: "never" })).toBeUndefined();
    expect(cnOnly.checkHost("agent2")).toBeUndefined();
  });

  test("checkEmail and checkIP are unaffected", () => {
    expect(cnOnly.checkEmail("ry@tinyclouds.org")).toBe("ry@tinyclouds.org");
    expect(cnOnly.checkEmail("ry@TINYCLOUDS.ORG")).toBe("ry@TINYCLOUDS.ORG");
    expect(cnOnly.checkEmail("sally@example.com")).toBeUndefined();
    expect(cnOnly.checkIP("127.0.0.1")).toBeUndefined();
  });
});

describe("X509Certificate.subjectAltName", () => {
  test("is the printed extension when present", () => {
    const cert = new X509Certificate(wildcardSanCertPem);
    expect(cert.subjectAltName).toBe("DNS:*.wildcard.example.com, DNS:exact.example.com");
  });

  test("is undefined when the extension is absent", () => {
    const cert = new X509Certificate(cnOnlyCertPem);
    expect(cert.subjectAltName).toBeUndefined();
    expect(cert.toLegacyObject().subjectaltname).toBeUndefined();
  });

  test("is the empty string when the extension holds an empty GeneralNames sequence", () => {
    const cert = new X509Certificate(emptySanCertPem);
    expect(cert.subjectAltName).toBe("");
    expect(cert.toLegacyObject().subjectaltname).toBe("");
  });
});

describe("X509Certificate getters that fail", () => {
  test("publicKey throws on every access when the key cannot be decoded (nothing stale is cached)", () => {
    const cert = new X509Certificate(brainpoolCertPem);
    expect(() => cert.publicKey).toThrow(expect.objectContaining({ code: "ERR_OSSL_X509_PUBLIC_KEY_DECODE_ERROR" }));
    expect(() => cert.publicKey).toThrow(expect.objectContaining({ code: "ERR_OSSL_X509_PUBLIC_KEY_DECODE_ERROR" }));
    // The rest of the certificate is still readable and cached.
    expect(cert.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(cert.fingerprint256).toBe(cert.fingerprint256);
    expect(cert.toLegacyObject().fingerprint256).toBe(cert.fingerprint256);
  });
});

describe("X509Certificate.prototype property descriptors", () => {
  // validFromDate/validToDate were registered as CustomAccessorOrValue instead of
  // CustomAccessor, so reading their descriptors asserted in debug builds.
  test("validFromDate and validToDate descriptors read like their siblings", () => {
    const proto = X509Certificate.prototype;
    for (const name of ["validFromDate", "validToDate", "validFrom", "validTo"] as const) {
      const desc = Object.getOwnPropertyDescriptor(proto, name)!;
      expect({ ...desc, get: typeof desc.get }).toEqual({
        get: "function",
        set: undefined,
        enumerable: true,
        configurable: true,
      });
    }

    const all = Object.getOwnPropertyDescriptors(proto);
    expect(typeof all.validFromDate.get).toBe("function");
    expect(typeof all.validToDate.get).toBe("function");
  });

  test("extracted validFromDate/validToDate getters work on an instance", () => {
    const cert = new X509Certificate(wildcardSanCertPem);
    const getFrom = Object.getOwnPropertyDescriptor(X509Certificate.prototype, "validFromDate")!.get!;
    const getTo = Object.getOwnPropertyDescriptor(X509Certificate.prototype, "validToDate")!.get!;
    expect(getFrom.call(cert)).toBeInstanceOf(Date);
    expect(getFrom.call(cert)).toEqual(cert.validFromDate);
    expect(getTo.call(cert)).toEqual(cert.validToDate);
  });
});

describe("X509Certificate with an empty subject/issuer DN", () => {
  // Self-signed, `openssl req -x509 -subj "/"`: both names are empty sequences.
  const emptyDN = `-----BEGIN CERTIFICATE-----
MIIBVjCB/aADAgECAhQuLsSmUr9yJhK85A6fr6KJxbEtYDAKBggqhkjOPQQDAjAA
MCAXDTI2MDgyMTA2NDgzOVoYDzIxMjYwNzI4MDY0ODM5WjAAMFkwEwYHKoZIzj0C
AQYIKoZIzj0DAQcDQgAEGcl07hz+Ga1M2lw9m8AcNiT3BtxyF0Yd4LNbAecfbGTy
frdyY7uFQMgDJFcSRpuGxCKVBtL1Ba4OvyyHzK5lAKNTMFEwHQYDVR0OBBYEFE8M
P5LabG8GsdSx97we9lwExHqZMB8GA1UdIwQYMBaAFE8MP5LabG8GsdSx97we9lwE
xHqZMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgVfqEVOsOI/6d
hkcWEa9g5HIqxKTzvSMRYn6eH6gefDYCIQCAl55J4qfVTELr1B5REAw5LFnQRBGN
vKS1+tUUY19gsw==
-----END CERTIFICATE-----`;

  test("subject/issuer are undefined and toLegacyObject() does not throw (matches Node)", () => {
    const cert = new X509Certificate(emptyDN);
    expect(cert.subject).toBeUndefined();
    expect(cert.issuer).toBeUndefined();
    const legacy = cert.toLegacyObject();
    expect(legacy.subject).toEqual({});
    expect(legacy.issuer).toEqual({});
    expect(cert.checkIssued(cert)).toBe(true);
  });
});

// Certificate, CRL and public-key PEM bodies are base64-coded by simdutf rather
// than BoringSSL's constant-time codec (private keys keep the latter). The bytes
// accepted and produced must match what EVP_DecodeUpdate/EVP_EncodeUpdate did.
describe("PEM base64 for public objects", () => {
  // 812 bytes: the base64 ends in one '=' and the last line is 60 columns.
  const der = new X509Certificate(wildcardSanCertPem).raw;
  const b64 = der.toString("base64");
  const pem64 = (label: string, buf: Buffer) =>
    `-----BEGIN ${label}-----\n` +
    buf
      .toString("base64")
      .replace(/(.{64})/g, "$1\n")
      .replace(/\n?$/, "\n") +
    `-----END ${label}-----\n`;
  const canonical = pem64("CERTIFICATE", der);

  test("X509Certificate#toString() is 64-column PEM with a terminated last line", () => {
    expect(der.length % 3).toBe(2);
    expect(canonical).toEndWith("=\n-----END CERTIFICATE-----\n");
    expect(new X509Certificate(wildcardSanCertPem).toString()).toBe(canonical);
    expect(new X509Certificate(der).toString()).toBe(canonical);
  });

  test("a body that is an exact multiple of 64 columns ends with exactly one newline", () => {
    const certs = rootCertificates.map(p => new X509Certificate(p));
    const exact = certs.find(c => c.raw.length % 48 === 0);
    expect(exact).toBeDefined();
    expect(exact!.toString()).toBe(pem64("CERTIFICATE", exact!.raw));
    // And every other residue too.
    for (const c of certs) expect(c.toString()).toBe(pem64("CERTIFICATE", c.raw));
  });

  test.each([
    ["CRLF line endings", canonical.replaceAll("\n", "\r\n")],
    ["no line breaks in the body", "-----BEGIN CERTIFICATE-----\n" + b64 + "\n-----END CERTIFICATE-----\n"],
    [
      "spaces and tabs inside the body",
      "-----BEGIN CERTIFICATE-----\n" + b64.replace(/(.{10})/g, "$1 \t") + "\n-----END CERTIFICATE-----\n",
    ],
    [
      "whitespace between data and padding",
      "-----BEGIN CERTIFICATE-----\n" + b64.replace(/=$/, "\n =") + "\n-----END CERTIFICATE-----\n",
    ],
  ])("decodes with %s", (_, pem) => {
    expect(new X509Certificate(pem).raw.equals(der)).toBe(true);
  });

  test.each([
    [
      "missing padding",
      "BAD_BASE64_DECODE",
      "-----BEGIN CERTIFICATE-----\n" + b64.replace(/=$/, "") + "\n-----END CERTIFICATE-----\n",
    ],
    ["excess padding", "BAD_BASE64_DECODE", "-----BEGIN CERTIFICATE-----\n" + b64 + "=\n-----END CERTIFICATE-----\n"],
    ["an invalid character", "BAD_BASE64_DECODE", canonical.replace(/^(.{40})./m, "$1*")],
    [
      "data after padding",
      "BAD_BASE64_DECODE",
      "-----BEGIN CERTIFICATE-----\n" + b64 + "AAAA\n-----END CERTIFICATE-----\n",
    ],
    ["an empty body", "NO_DATA", "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n"],
  ])("rejects a body with %s", (_, reason, pem) => {
    expect(() => new X509Certificate(pem)).toThrow(expect.objectContaining({ code: `ERR_OSSL_PEM_${reason}` }));
  });

  test("PUBLIC KEY PEM round-trips, and PRIVATE KEY PEM (constant-time path) is unaffected", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spkiDer = publicKey.export({ type: "spki", format: "der" });
    const spkiPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(spkiPem).toBe(pem64("PUBLIC KEY", spkiDer));
    expect(createPublicKey(spkiPem).export({ type: "spki", format: "der" }).equals(spkiDer)).toBe(true);
    const pkcs8Der = privateKey.export({ type: "pkcs8", format: "der" });
    const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    expect(pkcs8Pem).toBe(pem64("PRIVATE KEY", pkcs8Der));
    expect(createPrivateKey(pkcs8Pem).export({ type: "pkcs8", format: "der" }).equals(pkcs8Der)).toBe(true);
  });
});
