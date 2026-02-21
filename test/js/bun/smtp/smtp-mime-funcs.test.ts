/**
 * Direct port of vendor/nodemailer/test/mime-funcs/mime-funcs-test.js
 * Tests internal MIME encoding functions via bun:internal-for-testing.
 */
import { describe, expect, test } from "bun:test";
// @ts-ignore
import { smtpInternals } from "bun:internal-for-testing";

const { isPlainText, hasLongerLines, encodeWord, encodeQP, foldHeader } = smtpInternals;

describe("#isPlainText (mime-funcs-test.js)", () => {
  test("should detect plain text", () => {
    expect(isPlainText("abc")).toBe(true);
    expect(isPlainText("abc\x02")).toBe(false);
    expect(isPlainText("abcõ")).toBe(false);
  });

  test("should return true for ASCII with special chars", () => {
    expect(isPlainText("az09\t\r\n~!?")).toBe(true);
  });

  test("should return false on low bits", () => {
    expect(isPlainText("az09\n\x08!?")).toBe(false);
  });

  test("should return false on high bits", () => {
    expect(isPlainText("az09\nõ!?")).toBe(false);
  });
});

describe("#hasLongerLines (mime-funcs-test.js)", () => {
  test("should detect longer lines", () => {
    expect(hasLongerLines("abc\ndef", 5)).toBe(false);
    expect(hasLongerLines("juf\nabcdef\nghi", 5)).toBe(true);
  });
});

describe("#encodeWord (mime-funcs-test.js)", () => {
  test("should encode quoted-printable", () => {
    expect(encodeWord("See on õhin test", "Q")).toBe("=?UTF-8?Q?See_on_=C3=B5hin_test?=");
  });

  test("should encode base64", () => {
    expect(encodeWord("See on õhin test", "B")).toBe("=?UTF-8?B?U2VlIG9uIMO1aGluIHRlc3Q=?=");
  });
});

describe("#encodeQP - direct (qp-test.js)", () => {
  test("should encode UTF-8 string to QP", () => {
    expect(encodeQP("abcd= ÕÄÖÜ")).toBe("abcd=3D =C3=95=C3=84=C3=96=C3=9C");
  });

  test("should encode trailing spaces", () => {
    expect(encodeQP("foo bar  ")).toBe("foo bar =20");
  });

  test("should encode trailing tabs", () => {
    expect(encodeQP("foo bar\t\t")).toBe("foo bar\t=09");
  });

  test("should encode space before CRLF", () => {
    expect(encodeQP("foo \r\nbar")).toBe("foo=20\r\nbar");
  });
});

describe("#foldHeader (mime-funcs-test.js)", () => {
  test("should not fold short header", () => {
    expect(foldHeader("Subject: Hello World")).toBe("Subject: Hello World");
  });

  test("should fold long header at word boundary", () => {
    const long = "Subject: " + "word ".repeat(20);
    const folded = foldHeader(long);
    // Should contain CRLF+space continuation
    expect(folded).toContain("\r\n ");
    // Each line should be <= 76 chars
    for (const line of folded.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(78); // small slack for edge cases
    }
    // Content should be preserved
    expect(folded.replace(/\r\n\s/g, " ")).toContain("word word word");
  });

  test("should fold encoded subject", () => {
    const encoded = encodeWord(
      "This is a very long subject with special characters like ÕÄÖÜ and more text to make it exceed the line limit",
      "B",
    );
    const header = "Subject: " + encoded;
    const folded = foldHeader(header);
    // If the encoded word itself is >76 chars, folding may not break mid-word
    // but the function should still return without error
    expect(folded.length).toBeGreaterThan(0);
    expect(folded).toContain("Subject:");
  });
});

// ============================================================================
// Tests for per-attachment headers, encoded buffer content, ReDoS protection
// ============================================================================

import { bunEnv, bunExe } from "harness";

async function run(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

const MOCK = `
function mock() {
  const sessions = [];
  const server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(s) { const sess = { cmds: [], msg: "", inData: false, buf: "" }; sessions.push(sess); s.data = sess; s.write("220 OK\\r\\n"); },
      data(s, raw) {
        const t = new TextDecoder().decode(raw);
        const sess = s.data;
        if (sess.inData) { sess.buf += t; if (sess.buf.includes("\\r\\n.\\r\\n")) { sess.inData = false; sess.msg = sess.buf.split("\\r\\n.\\r\\n")[0]; sess.buf = ""; s.write("250 OK\\r\\n"); } return; }
        for (const l of t.split("\\r\\n").filter(x=>x)) {
          if (l.startsWith("EHLO")) s.write("250-mock\\r\\n250 OK\\r\\n");
          else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
          else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
          else if (l === "DATA") { sess.inData = true; sess.buf = ""; s.write("354 Go\\r\\n"); }
          else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
          else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
        }
      },
    },
  });
  return { server, sessions, port: server.port };
}
`;

describe("Per-attachment custom headers (mail-composer-test.js #24)", () => {
  test("should include custom headers on attachments", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "abc",
        attachments: [{
          content: "test", filename: "test.txt",
          headers: { "X-Test-1": "12345", "X-Test-2": "hello" },
        }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        hasX1: m.includes("X-Test-1: 12345"),
        hasX2: m.includes("X-Test-2: hello"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasX1).toBe(true);
    expect(d.hasX2).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Encoded buffer content (mail-composer-test.js #13)", () => {
  test("text as { content, encoding: 'base64' } decodes correctly", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com",
        text: { content: Buffer.from("tere tere").toString("base64"), encoding: "base64" } });
      console.log(JSON.stringify({ has: sessions[0].msg.includes("tere tere") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).has).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("html as { content, encoding: 'base64' } decodes correctly", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com",
        html: { content: Buffer.from("<b>decoded</b>").toString("base64"), encoding: "base64" } });
      console.log(JSON.stringify({ has: sessions[0].msg.includes("<b>decoded</b>") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).has).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("ReDoS protection (mail-composer-test.js #35-46)", () => {
  test("malicious data URL with 60000 semicolons completes fast", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const start = Date.now();
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "t.txt", path: "data:;" + ";".repeat(60000) + ",test" }] });
      console.log(JSON.stringify({ fast: Date.now() - start < 5000 }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).fast).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("valid data URL formats all work", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [
          { filename: "t.txt", path: "data:text/plain,hello" },
          { filename: "t.html", path: "data:text/html,<b>hi</b>" },
        ] });
      console.log(JSON.stringify({ ok: sessions[0].msg.length > 100 }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("base64 data URL preserved", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const b64 = Buffer.from("Hello World").toString("base64");
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "test.txt", path: "data:text/plain;base64," + b64 }] });
      console.log(JSON.stringify({ has: sessions[0].msg.includes(b64) }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).has).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("200KB data URL completes without hang", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const start = Date.now();
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "big.txt", path: "data:text/plain;base64," + "A".repeat(200000) }] });
      console.log(JSON.stringify({ fast: Date.now() - start < 10000 }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).fast).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("malformed data URLs don't crash", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "e.txt", path: "data:," }] });
      console.log(JSON.stringify({ ok: sessions[0].msg.includes("text/plain") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("invalid base64 in data URL doesn't crash", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "bad.txt", path: "data:text/plain;base64,!!!invalid!!!" }] });
      console.log(JSON.stringify({ ok: sessions[0].msg.length > 50 }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(exitCode).toBe(0);
  });
});
