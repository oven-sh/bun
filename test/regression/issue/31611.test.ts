// https://github.com/oven-sh/bun/issues/31611
// generate-root-certs.pl treated any '#' line as end-of-trust-object, so an inline
// "# For Server Distrust After:" comment made it drop Izenpe.com from the bundle.

import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

const perl = Bun.which("perl");
const usocketsDir = join(import.meta.dirname, "../../../packages/bun-usockets");

// End-to-end: the bundled store must contain exactly the roots NSS marks as
// server-auth TRUSTED_DELEGATOR. Catches future generator/sync regressions.
test("tls.rootCertificates contains every SERVER_AUTH TRUSTED_DELEGATOR from certdata.txt", () => {
  const certdata = readFileSync(join(usocketsDir, "certdata.txt"), "utf8");
  const expected = certdata.match(/^CKA_TRUST_SERVER_AUTH CK_TRUST CKT_NSS_TRUSTED_DELEGATOR$/gm)?.length;
  expect(expected).toBeGreaterThan(0);

  // Mirror the generator's hard-coded TrustCor exclusion (currently 0 entries).
  const labels = [...certdata.matchAll(/^CKA_LABEL UTF8 "(.*)"$/gm)].map(m => m[1]);
  const excluded = new Set(labels.filter(l => /TrustCor/.test(l))).size;

  expect(tls.rootCertificates.length).toBe(expected! - excluded);

  const fingerprints = new Set(tls.rootCertificates.map(pem => new X509Certificate(pem).fingerprint256));
  // Izenpe.com: the root the broken parser dropped.
  expect(
    fingerprints.has("25:30:CC:8E:98:32:15:02:BA:D9:6F:9B:1F:BA:1B:09:9E:2D:29:9E:0F:45:48:BB:91:4F:36:3B:C0:D4:53:1F"),
  ).toBe(true);
});

// Throwaway self-signed DER cert as NSS MULTILINE_OCTAL; the generator only
// base64-encodes it so the bytes themselves do not matter.
const CERT_OCTAL = String.raw`\060\202\001\047\060\201\316\240\003\002\001\002\002\011\000\375
\177\346\040\234\273\377\307\060\012\006\010\052\206\110\316\075
\004\003\002\060\017\061\015\060\013\006\003\125\004\003\014\004
\124\145\163\164\060\036\027\015\062\064\060\061\060\061\060\060
\060\060\060\060\132\027\015\063\064\060\061\060\061\060\060\060
\060\060\060\132\060\017\061\015\060\013\006\003\125\004\003\014
\004\124\145\163\164\060\131\060\023\006\007\052\206\110\316\075
\002\001\006\010\052\206\110\316\075\003\001\007\003\102\000\004
\173\065\326\200\241\065\277\120\250\230\313\305\063\234\361\121
\344\322\102\251\063\040\056\250\066\310\211\274\250\067\261\277
\251\163\031\274\052\213\042\225\045\174\353\301\270\346\061\072
\273\301\306\056\266\046\023\275\257\225\342\274\377\251\221\242
\060\012\006\010\052\206\110\316\075\004\003\002\003\107\000\060
\104`;

function certObject(label: string): string {
  return [
    `# Certificate "${label}"`,
    `CKA_CLASS CK_OBJECT_CLASS CKO_CERTIFICATE`,
    `CKA_TOKEN CK_BBOOL CK_TRUE`,
    `CKA_LABEL UTF8 "${label}"`,
    `CKA_CERTIFICATE_TYPE CK_CERTIFICATE_TYPE CKC_X_509`,
    `CKA_VALUE MULTILINE_OCTAL`,
    CERT_OCTAL,
    `END`,
  ].join("\n");
}

function trustObject(label: string, sha1: string, trustBits: string): string {
  return [
    `# Trust for "${label}"`,
    `CKA_CLASS CK_OBJECT_CLASS CKO_NSS_TRUST`,
    `CKA_LABEL UTF8 "${label}"`,
    `CKA_CERT_SHA1_HASH MULTILINE_OCTAL`,
    sha1,
    `END`,
    trustBits,
  ].join("\n");
}

// NSS objects are blank-line delimited; the trust scan relies on that.
function joinObjects(...objects: string[]): string {
  return objects.join("\n\n") + "\n";
}

// Unit check on the checked-in generator: feed it a fixture shaped like
// Izenpe.com's trust object (inline comment before CKA_TRUST_SERVER_AUTH).
test.skipIf(!perl)("generate-root-certs.pl keeps roots with an inline trust-object comment (Izenpe.com)", () => {
  const script = readFileSync(join(usocketsDir, "generate-root-certs.pl"), "utf8");

  const certdata = joinObjects(
    `# Minimal certdata.txt fixture\nCVS_ID "fixture"`,
    // Control: trust bits appear directly, no inline comment.
    certObject("DirectTrustRoot"),
    trustObject(
      "DirectTrustRoot",
      String.raw`\001\002\003\004`,
      [
        `CKA_TRUST_SERVER_AUTH CK_TRUST CKT_NSS_TRUSTED_DELEGATOR`,
        `CKA_TRUST_EMAIL_PROTECTION CK_TRUST CKT_NSS_MUST_VERIFY_TRUST`,
        `CKA_TRUST_STEP_UP_APPROVED CK_BBOOL CK_FALSE`,
      ].join("\n"),
    ),
    // Izenpe.com shape: comment + CKA_NSS_SERVER_DISTRUST_AFTER before trust bits.
    certObject("DistrustAfterRoot"),
    trustObject(
      "DistrustAfterRoot",
      String.raw`\005\006\007\010`,
      [
        `# For Server Distrust After: Wed Apr 15 23:59:59 2026`,
        `CKA_NSS_SERVER_DISTRUST_AFTER MULTILINE_OCTAL`,
        String.raw`\062\060\062\066\060\064\061\065`,
        `END`,
        `CKA_TRUST_SERVER_AUTH CK_TRUST CKT_NSS_TRUSTED_DELEGATOR`,
        `CKA_TRUST_EMAIL_PROTECTION CK_TRUST CKT_NSS_MUST_VERIFY_TRUST`,
        `CKA_TRUST_STEP_UP_APPROVED CK_BBOOL CK_FALSE`,
      ].join("\n"),
    ),
  );

  using dir = tempDir("root-certs-parser", {
    "generate-root-certs.pl": script,
    "certdata.txt": certdata,
  });

  execFileSync(perl!, ["generate-root-certs.pl", "root_certs.h"], {
    cwd: String(dir),
    env: bunEnv,
    encoding: "utf8",
  });

  const generated = readFileSync(join(String(dir), "root_certs.h"), "utf8");

  // Control root + inline-comment root must both survive.
  expect(generated).toContain("DirectTrustRoot");
  expect(generated).toContain("DistrustAfterRoot");
  expect(generated.match(/-----BEGIN CERTIFICATE-----/g) ?? []).toHaveLength(2);
});
