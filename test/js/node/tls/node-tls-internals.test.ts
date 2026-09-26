import { canonicalizeIP } from "bun:internal-for-testing";
import { createTest } from "node-harness";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCACertificates, rootCertificates } from "tls";
const { describe, expect } = createTest(import.meta.path);

describe("NodeTLS.cpp", () => {
  test("canonicalizeIP", () => {
    expect(canonicalizeIP("127.0.0.1")).toBe("127.0.0.1");
    expect(canonicalizeIP("10.1.0.1")).toBe("10.1.0.1");
    expect(canonicalizeIP("::1")).toBe("::1");
    expect(canonicalizeIP("fe80:0:0:0:0:0:0:1")).toBe("fe80::1");
    expect(canonicalizeIP("fe80:0:0:0:0:0:0:0")).toBe("fe80::");
    expect(canonicalizeIP("fe80::0000:0010:0001")).toBe("fe80::10:1");
    expect(canonicalizeIP("0001:2222:3333:4444:5555:6666:7777:0088")).toBe("1:2222:3333:4444:5555:6666:7777:88");

    expect(canonicalizeIP("0001:2222:3333:4444:5555:6666::")).toBe("1:2222:3333:4444:5555:6666::");

    expect(canonicalizeIP("a002:B12:00Ba:4444:5555:6666:0:0")).toBe("a002:b12:ba:4444:5555:6666::");

    // IPv4 address represented in IPv6
    expect(canonicalizeIP("0:0:0:0:0:ffff:c0a8:101")).toBe("::ffff:192.168.1.1");

    expect(canonicalizeIP("::ffff:192.168.1.1")).toBe("::ffff:192.168.1.1");
  });

  // Node.js parses with libuv's uv_inet_pton: a dotted quad, or an IPv6 address
  // up to the first "%". The zone id is not in the result and is not checked.
  // The text is a C string there, so it ends at a NUL. Every expected value
  // was taken from Node.js v26.3.0.
  test("canonicalizeIP reads an address in the strict form and drops a zone id", () => {
    const long = `fe80::1%${Buffer.alloc(64, "z").toString()}`;
    const expected: Record<string, string | null> = {
      "::1%lo": "::1",
      "fe80::1%eth0": "fe80::1",
      "FE80:0:0:0:0:0:0:1%eth0": "fe80::1",
      "::ffff:1.2.3.4%lo": "::ffff:1.2.3.4",
      "1:2:3:4:5:6:7::%lo": "1:2:3:4:5:6:7:0",
      "fe80::1%12": "fe80::1",
      "fe80::1%": "fe80::1",
      "fe80::1%eth0%eth1": "fe80::1",
      "fe80::1%br_lan": "fe80::1",
      "fe80::1%eth0/64": "fe80::1",
      "fe80::1%et\0h0": "fe80::1",
      "::1\0": "::1",
      "::1\0%lo": "::1",
      "1.2.3.4\0/8": "1.2.3.4",
      [long]: "fe80::1",
      // An IPv4 address takes no zone, and the address before the zone is in the strict form.
      "1.2.3.4%lo": null,
      "::1.2.3%lo": null,
      "::01.2.3.4%lo": null,
      "fe80::12345%lo": null,
      "fe80::1 %eth0": null,
      "fe80::1/64%eth0": null,
      "10.0.0\0%a/b": null,
      "%lo": null,
      // ares_inet_pton reads each of these: "127.1" as 127.1.0.0, "10" as 10.0.0.0.
      "127.1": null,
      "10": null,
      "0x7f000001": null,
      "127.000.000.001": null,
      "1.2.3": null,
      "01.2.3.4": null,
      "::1.2.3": null,
      "::01.2.3.4": null,
      "1.2.3.4/8": null,
      "::1/64": null,
      "127.1\0": null,
    };
    const actual = Object.keys(expected).map(text => [text, canonicalizeIP(text) ?? null]);
    expect(Object.fromEntries(actual)).toEqual(expected);
  });

  test("rootCertificates", () => {
    expect(rootCertificates).toBeInstanceOf(Array);
    expect(rootCertificates.length).toBeGreaterThan(0);
    expect(typeof rootCertificates[0]).toBe("string");

    for (const cert of rootCertificates) {
      expect(cert).toStartWith("-----BEGIN CERTIFICATE-----");
      expect(cert).toEndWith("-----END CERTIFICATE-----");
    }
  });

  // The bundled roots are embedded as DER and tls.rootCertificates re-encodes
  // them; the strings must stay exactly what they were when they were embedded
  // as PEM text (72-column body, trailing newline before the END line, none
  // after), and each must be the certificate it claims to be.
  test("rootCertificates are the DER roots re-encoded in the historical format", () => {
    for (const pem of rootCertificates) {
      const lines = pem.split("\n");
      expect(lines[0]).toBe("-----BEGIN CERTIFICATE-----");
      expect(lines.at(-1)).toBe("-----END CERTIFICATE-----");
      const body = lines.slice(1, -1);
      expect(body.length).toBeGreaterThan(0);
      for (let i = 0; i < body.length - 1; i++) expect(body[i].length).toBe(72);
      expect(body.at(-1)!.length).toBeGreaterThan(0);
      expect(body.at(-1)!.length).toBeLessThanOrEqual(72);
      const der = new X509Certificate(pem).raw;
      expect(body.join("")).toBe(der.toString("base64"));
    }
    expect(new Set(rootCertificates).size).toBe(rootCertificates.length);
  });

  // The binary under test must embed exactly the packages/bun-usockets/root_certs.der in this checkout (format:
  // u32 count, u32 offsets[count + 1], DER certificates back to back; little-endian), listed by root_certs.txt.
  test("rootCertificates are this checkout's root_certs.der, in order", () => {
    const usockets = join(import.meta.dir, "../../../../packages/bun-usockets");
    const blob = readFileSync(join(usockets, "root_certs.der"));
    const names = readFileSync(join(usockets, "root_certs.txt"), "utf8")
      .split("\n")
      .filter(line => line && !line.startsWith("#"));
    const count = blob.readUInt32LE(0);
    const offset = (i: number) => blob.readUInt32LE(4 + 4 * i);
    const data = blob.subarray(4 + 4 * (count + 1));
    expect(data.length).toBe(offset(count));
    expect(names.length).toBe(count);

    expect(rootCertificates.length).toBe(count);
    expect(getCACertificates("bundled")).toEqual(rootCertificates);
    for (let i = 0; i < count; i++) {
      const der = data.subarray(offset(i), offset(i + 1));
      const cert = new X509Certificate(rootCertificates[i]);
      expect(cert.raw.equals(der)).toBe(true);
      // Every entry is a self-issued CA certificate.
      expect(cert.ca).toBe(true);
      expect(cert.issuer).toBe(cert.subject);
    }
  });
});
