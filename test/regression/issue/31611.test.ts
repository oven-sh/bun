// Regression test for https://github.com/oven-sh/bun/issues/31611
//
// `packages/bun-usockets/generate-root-certs.pl` converts Mozilla NSS's
// `certdata.txt` into the compiled-in root-certificate bundle
// (`src/crypto/root_certs.h`). While scanning a certificate's trust object it
// used to treat *any* comment line (`/^#/`) as the end of the object. NSS
// 3.123.1 puts a `# For Server Distrust After:` comment (and a following
// `CKA_NSS_SERVER_DISTRUST_AFTER` block) *inside* `Izenpe.com`'s trust object,
// before its `CKA_TRUST_SERVER_AUTH` bit. The old parser bailed at the comment,
// never read the server-auth trust, and silently dropped the root from the
// bundle.
//
// Trust objects are delimited by a blank line, not by a comment, so the parser
// must skip inline comments instead of stopping on them. This test feeds the
// real generator a minimal `certdata.txt` containing two roots — one with its
// trust bits directly (the control) and one shaped like NSS 3.123.1's
// `Izenpe.com` with an inline comment before the trust bits — and asserts that
// both survive into the generated output.

import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const perl = Bun.which("perl");

// A throwaway self-signed DER certificate, as NSS MULTILINE_OCTAL lines. The
// exact bytes are irrelevant to the parser bug — the generator only base64s
// them back out — so a single tiny fixture cert is reused for both roots.
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

// Mirrors Mozilla NSS `certdata.txt`: a CKO_CERTIFICATE object followed by a
// matching CKO_NSS_TRUST object whose `trustBits` lines decide whether the
// generator keeps the cert. In real `certdata.txt` every object is separated
// by a blank line, which is what terminates the trust-object scan — `joinObjects`
// reproduces that, and it is load-bearing: without it the trust-object scan
// runs past the end of the object.
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

// NSS objects are delimited by a blank line; keep the same for the fixture and
// end the file with a trailing newline.
function joinObjects(...objects: string[]): string {
  return objects.join("\n\n") + "\n";
}

// The generator always reads `certdata.txt` from its own directory, so copy the
// real script next to a fixture `certdata.txt` and run it there. This exercises
// the checked-in generator verbatim rather than a reimplementation.
test.skipIf(!perl)("generate-root-certs.pl keeps roots with an inline trust-object comment (Izenpe.com)", () => {
  const scriptPath = join(import.meta.dirname, "../../../packages/bun-usockets/generate-root-certs.pl");
  const script = readFileSync(scriptPath, "utf8");

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
    // NSS 3.123.1 Izenpe.com shape: a comment and a CKA_NSS_SERVER_DISTRUST_AFTER
    // block sit inside the trust object, before the server-auth trust bit.
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

  // Output path is the script's only argument; input is always ./certdata.txt.
  execFileSync(perl!, ["generate-root-certs.pl", "root_certs.h"], {
    cwd: String(dir),
    env: bunEnv,
    encoding: "utf8",
  });

  const generated = readFileSync(join(String(dir), "root_certs.h"), "utf8");

  // The control root proves the generator works in general; the
  // inline-comment root is the one the old parser dropped. Both must survive.
  expect(generated).toContain("DirectTrustRoot");
  expect(generated).toContain("DistrustAfterRoot");

  // Two roots in, two CERTIFICATE blocks out — nothing was skipped.
  const certBlocks = generated.match(/-----BEGIN CERTIFICATE-----/g) ?? [];
  expect(certBlocks).toHaveLength(2);
});
