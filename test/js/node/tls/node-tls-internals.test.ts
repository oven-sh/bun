import { canonicalizeIP } from "bun:internal-for-testing";
import { createTest } from "node-harness";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "tls";
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

  test("rootCertificates", () => {
    expect(rootCertificates).toBeInstanceOf(Array);
    expect(rootCertificates.length).toBeGreaterThan(0);
    expect(typeof rootCertificates[0]).toBe("string");

    for (const cert of rootCertificates) {
      expect(cert).toStartWith("-----BEGIN CERTIFICATE-----");
      expect(cert).toEndWith("-----END CERTIFICATE-----");
    }
  });

  // Supply-chain integrity: the compiled-in trust store must be exactly the
  // DER blobs committed in root_certs.h. If a PR injects/alters a root in the
  // binary while hiding it from tls.rootCertificates (or vice versa), this
  // fails. Pair with test/regression/issue/31611.test.ts which pins
  // root_certs.h itself to Mozilla's certdata.txt.
  test("tls.rootCertificates matches the DER blobs in root_certs.h exactly", () => {
    const headerPath = join(import.meta.dirname, "../../../../packages/bun-usockets/src/crypto/root_certs.h");
    const header = readFileSync(headerPath, "utf8");

    const sha256 = (buf: Uint8Array) =>
      createHash("sha256").update(buf).digest("hex").toUpperCase().match(/../g)!.join(":");

    const sourceFingerprints: string[] = [];
    for (const m of header.matchAll(/^static const unsigned char root_cert_der_\d+\[\] = \{\n([\s\S]*?)\};/gm)) {
      const bytes = Uint8Array.from(m[1].match(/0x[0-9a-f]{2}/gi)!, h => parseInt(h, 16));
      sourceFingerprints.push(sha256(bytes));
    }

    const tableEntries =
      header.match(/static struct us_cert_der_t root_certs\[\] = \{\n([\s\S]*?)\};/)?.[1].match(/\{root_cert_der_\d+,/g)
        ?.length ?? 0;

    const runtimeFingerprints = rootCertificates.map(pem => new X509Certificate(pem).fingerprint256);

    // Same certs, same order, nothing added or removed on either side.
    expect(runtimeFingerprints).toEqual(sourceFingerprints);
    // The lookup table must reference every DER array and nothing else.
    expect(tableEntries).toBe(sourceFingerprints.length);
    // No duplicate roots.
    expect(new Set(runtimeFingerprints).size).toBe(runtimeFingerprints.length);
  });
});
