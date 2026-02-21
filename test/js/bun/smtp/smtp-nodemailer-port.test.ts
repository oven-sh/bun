/**
 * Tests ported DIRECTLY from vendor/nodemailer test suite.
 * Each test references the original nodemailer test file and test name.
 * These verify byte-level compatibility with nodemailer behavior.
 */
import { describe, expect, test } from "bun:test";
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

// Reusable mock SMTP server
const MOCK = `
function mock(opts = {}) {
  const sessions = [];
  const server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(socket) {
        const s = { cmds: [], msg: "", inData: false, buf: "", authed: false };
        sessions.push(s);
        socket.data = s;
        socket.write("220 mock\\r\\n");
      },
      data(socket, raw) {
        const text = new TextDecoder().decode(raw);
        const s = socket.data;
        if (s.inData) {
          s.buf += text;
          if (s.buf.includes("\\r\\n.\\r\\n")) {
            s.inData = false;
            s.msg = s.buf.split("\\r\\n.\\r\\n")[0];
            s.buf = "";
            socket.write("250 OK\\r\\n");
          }
          return;
        }
        for (const line of text.split("\\r\\n").filter(l => l)) {
          s.cmds.push(line);
          if (line.startsWith("EHLO") || line.startsWith("HELO")) {
            let r = "250-mock\\r\\n";
            if (opts.auth) r += "250-AUTH PLAIN LOGIN CRAM-MD5\\r\\n";
            r += "250-SIZE 10485760\\r\\n250 OK\\r\\n";
            socket.write(r);
          } else if (line.startsWith("AUTH PLAIN ")) {
            const cred = Buffer.from(line.slice(11), "base64").toString();
            const [, user, pass] = cred.split("\\x00");
            if (opts.auth && user === opts.auth.user && pass === opts.auth.pass) {
              s.authed = true;
              socket.write("235 OK\\r\\n");
            } else socket.write("535 Bad\\r\\n");
          } else if (line === "AUTH LOGIN") {
            socket.write("334 VXNlcm5hbWU6\\r\\n");
          } else if (line.startsWith("AUTH CRAM-MD5")) {
            // Send a base64-encoded challenge
            const challenge = Buffer.from("<test.challenge@mock>").toString("base64");
            socket.write("334 " + challenge + "\\r\\n");
          } else if (line.startsWith("MAIL FROM:")) {
            if (opts.rejectFrom) socket.write("550 Rejected\\r\\n");
            else socket.write("250 OK\\r\\n");
          } else if (line.startsWith("RCPT TO:")) {
            const addr = line.match(/<(.+?)>/)?.[1];
            if (opts.rejectTo === addr) socket.write("550 Rejected\\r\\n");
            else socket.write("250 OK\\r\\n");
          } else if (line === "DATA") {
            s.inData = true; s.buf = "";
            socket.write("354 Go\\r\\n");
          } else if (line.startsWith("RSET")) socket.write("250 OK\\r\\n");
          else if (line === "QUIT") { socket.write("221 Bye\\r\\n"); socket.end(); }
          else {
            // For AUTH LOGIN flow - check if this is base64 username/password
            if (s.cmds[s.cmds.length - 2] === "AUTH LOGIN" || s.cmds.some(c => c === "334 VXNlcm5hbWU6")) {
              socket.write("334 UGFzc3dvcmQ6\\r\\n");
            } else {
              // CRAM-MD5 response or other - just accept
              s.authed = true;
              socket.write("235 OK\\r\\n");
            }
          }
        }
      },
    },
  });
  return { server, sessions, port: server.port };
}
`;

// ============================================================================
// QP ENCODING (from vendor/nodemailer/test/qp/qp-test.js)
// ============================================================================
describe("QP Encoding (nodemailer qp-test.js)", () => {
  // Test 1: encode fixtures
  const fixtures: [string, string][] = [
    ["abcd= ÕÄÖÜ", "abcd=3D =C3=95=C3=84=C3=96=C3=9C"],
    ["foo bar  ", "foo bar =20"],
    ["foo bar\t\t", "foo bar\t=09"],
    ["foo \r\nbar", "foo=20\r\nbar"],
  ];

  for (const [input, expected] of fixtures) {
    test(`encode: ${JSON.stringify(input).slice(0, 30)}`, async () => {
      const { stdout, exitCode } = await run(`
        ${MOCK}
        const { server, sessions, port } = mock();
        const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await c.send({ from: "a@b.com", to: "c@d.com", text: ${JSON.stringify(input)} });
        const parts = sessions[0].msg.split("\\r\\n\\r\\n");
        console.log(parts.slice(1).join("\\r\\n\\r\\n"));
        c.close(); server.stop();
      `);
      expect(stdout).toBe(expected);
      expect(exitCode).toBe(0);
    });
  }
});

// ============================================================================
// WELL-KNOWN SERVICES (from vendor/nodemailer/test/well-known/well-known-test.js)
// ============================================================================
describe("Well-Known Services (nodemailer well-known-test.js)", () => {
  test("should find Gmail by key", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ service: "Gmail" });
      console.log(JSON.stringify({ secure: c.secure }));
      c.close();
    `);
    expect(JSON.parse(stdout)).toEqual({ secure: true });
    expect(exitCode).toBe(0);
  });

  test("should find Gmail by alias 'Google Mail'", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ service: "Google Mail" });
      console.log(JSON.stringify({ secure: c.secure }));
      c.close();
    `);
    // Note: our well_known normalizes "Google Mail" -> "googlemail" which maps to Gmail
    expect(JSON.parse(stdout)).toEqual({ secure: true });
    expect(exitCode).toBe(0);
  });

  test("should find Gmail by domain 'gmail.com'", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ service: "gmail.com" });
      console.log(JSON.stringify({ secure: c.secure }));
      c.close();
    `);
    expect(JSON.parse(stdout)).toEqual({ secure: true });
    expect(exitCode).toBe(0);
  });

  test("should return defaults for unknown service", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ service: "zzzzzz", host: "localhost" });
      console.log(JSON.stringify({ secure: c.secure }));
      c.close();
    `);
    // Unknown service, host override present, default port 587 not secure
    expect(JSON.parse(stdout)).toEqual({ secure: false });
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// MAIL COMPOSER - MIME STRUCTURE (from vendor/nodemailer/test/mail-composer/mail-composer-test.js)
// ============================================================================
describe("MIME Structure (nodemailer mail-composer-test.js)", () => {
  test("text only: single text/plain", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "abc" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        plain: m.includes("text/plain"),
        noMulti: !m.includes("multipart"),
        body: m.includes("abc"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ plain: true, noMulti: true, body: true });
    expect(exitCode).toBe(0);
  });

  test("html only: single text/html", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", html: "<b>def</b>" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        html: m.includes("text/html"),
        noMulti: !m.includes("multipart"),
        body: m.includes("<b>def</b>"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ html: true, noMulti: true, body: true });
    expect(exitCode).toBe(0);
  });

  test("text+html: multipart/alternative, text before html", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "abc", html: "<b>def</b>" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        alt: m.includes("multipart/alternative"),
        textFirst: m.indexOf("text/plain") < m.indexOf("text/html"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ alt: true, textFirst: true });
    expect(exitCode).toBe(0);
  });

  test("text+attachment: multipart/mixed", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "abc", attachments: [{ content: "def", filename: "t.txt" }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        mixed: m.includes("multipart/mixed"),
        att: m.includes("attachment"),
        b64: m.includes("base64"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ mixed: true, att: true, b64: true });
    expect(exitCode).toBe(0);
  });

  test("text+html+attachment: mixed with nested alternative", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "t", html: "<b>h</b>",
        attachments: [{ content: "f", filename: "a.txt" }] });
      const m = sessions[0].msg;
      const mixedPos = m.indexOf("multipart/mixed");
      const altPos = m.indexOf("multipart/alternative");
      console.log(JSON.stringify({
        mixed: mixedPos >= 0, alt: altPos >= 0,
        mixedFirst: mixedPos < altPos,
        att: m.includes('filename="a.txt"'),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ mixed: true, alt: true, mixedFirst: true, att: true });
    expect(exitCode).toBe(0);
  });

  test("should discard BCC from headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "b@c.com", bcc: "secret@d.com", text: "x" });
      const m = sessions[0].msg;
      const rcpts = sessions[0].cmds.filter(c => c.startsWith("RCPT TO:"));
      console.log(JSON.stringify({
        noBcc: !m.includes("Bcc:") && !m.includes("bcc:"),
        bccInEnvelope: rcpts.some(r => r.includes("secret@d.com")),
        rcptCount: rcpts.length,
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.noBcc).toBe(true);
    expect(d.bccInEnvelope).toBe(true);
    expect(d.rcptCount).toBe(2);
    expect(exitCode).toBe(0);
  });

  test("should use raw message as-is", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const raw = "From: r@t.com\\r\\nTo: d@t.com\\r\\nSubject: Raw\\r\\n\\r\\nRaw body";
      await c.send({ from: "r@t.com", to: "d@t.com", raw });
      console.log(JSON.stringify({
        exact: sessions[0].msg === raw,
        noXMailer: !sessions[0].msg.includes("X-Mailer"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ exact: true, noXMailer: true });
    expect(exitCode).toBe(0);
  });

  test("CID attachment should be inline with Content-Id", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com",
        html: '<img src="cid:img1"/>',
        attachments: [{ content: "px", filename: "i.png", cid: "img1" }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        cid: m.includes("Content-Id: <img1>"),
        inline: m.includes("inline"),
        png: m.includes("image/png"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ cid: true, inline: true, png: true });
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// RFC 2047 HEADER ENCODING (from vendor/nodemailer/test/mime-funcs/mime-funcs-test.js)
// ============================================================================
describe("RFC 2047 Header Encoding (nodemailer mime-funcs-test.js)", () => {
  test("should encode non-ASCII subject as =?UTF-8?B?...?=", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", subject: "See on õhin test", text: "x" });
      const m = sessions[0].msg;
      const subj = m.split("\\r\\n").find(l => l.startsWith("Subject:"));
      const match = subj.match(/=\\?UTF-8\\?B\\?(.+?)\\?=/);
      console.log(JSON.stringify({
        encoded: !!match,
        decoded: match ? Buffer.from(match[1], "base64").toString() : "",
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.encoded).toBe(true);
    expect(d.decoded).toBe("See on õhin test");
    expect(exitCode).toBe(0);
  });

  test("should NOT encode pure ASCII subject", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", subject: "Hello World", text: "x" });
      const subj = sessions[0].msg.split("\\r\\n").find(l => l.startsWith("Subject:"));
      console.log(subj);
      c.close(); server.stop();
    `);
    expect(stdout).toBe("Subject: Hello World");
    expect(exitCode).toBe(0);
  });

  test("should encode emoji subject", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", subject: "Hello 🌍💮", text: "x" });
      const subj = sessions[0].msg.split("\\r\\n").find(l => l.startsWith("Subject:"));
      const match = subj.match(/=\\?UTF-8\\?B\\?(.+?)\\?=/);
      console.log(Buffer.from(match[1], "base64").toString());
      c.close(); server.stop();
    `);
    expect(stdout).toBe("Hello 🌍💮");
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// ADDRESS PARSING (from vendor/nodemailer/test/addressparser/addressparser-test.js)
// ============================================================================
describe("Address Parsing (nodemailer addressparser-test.js)", () => {
  test("extract email from 'Name <email>'", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: '"Andris Reinman" <andris@tr.ee>', to: '"Dest" <dest@ex.com>', text: "x" });
      const cmds = sessions[0].cmds;
      console.log(JSON.stringify({
        from: cmds.find(c => c.startsWith("MAIL FROM:")),
        to: cmds.find(c => c.startsWith("RCPT TO:")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.from).toContain("<andris@tr.ee>");
    expect(d.to).toBe("RCPT TO:<dest@ex.com>");
    expect(exitCode).toBe(0);
  });

  test("bare email without brackets", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "plain@email.com", to: "dest@email.com", text: "x" });
      const cmds = sessions[0].cmds;
      console.log(JSON.stringify({
        from: cmds.find(c => c.startsWith("MAIL FROM:")),
        to: cmds.find(c => c.startsWith("RCPT TO:")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.from).toContain("<plain@email.com>");
    expect(d.to).toBe("RCPT TO:<dest@email.com>");
    expect(exitCode).toBe(0);
  });

  test("preserve display names in headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: '"John Doe" <john@ex.com>', to: '"Alice" <alice@ex.com>', text: "x" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        from: m.split("\\r\\n").find(l => l.startsWith("From:")),
        to: m.split("\\r\\n").find(l => l.startsWith("To:")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.from).toBe('From: "John Doe" <john@ex.com>');
    expect(d.to).toBe('To: "Alice" <alice@ex.com>');
    expect(exitCode).toBe(0);
  });

  test("array To header", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: ["x@y.com", "z@w.com"], text: "x" });
      const m = sessions[0].msg;
      const to = m.split("\\r\\n").find(l => l.startsWith("To:"));
      console.log(JSON.stringify({ both: to.includes("x@y.com") && to.includes("z@w.com") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).both).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// SMTP PROTOCOL (from vendor/nodemailer/test/smtp-transport/smtp-tranport-test.js)
// ============================================================================
describe("SMTP Protocol (nodemailer smtp-transport-test.js)", () => {
  test("should fail envelope with rejected sender", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectFrom: true });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "bad@sender.com", to: "ok@dest.com", text: "x" });
        console.log("NO_ERROR");
      } catch(e) { console.log("ERR:" + e.message); }
      c.close(); server.stop();
    `);
    expect(stdout).toContain("ERR:");
    expect(stdout).toContain("MAIL FROM rejected");
    expect(exitCode).toBe(0);
  });

  test("should handle partial recipient rejection", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectTo: "bad@ex.com" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({ from: "a@b.com", to: ["good@ex.com", "bad@ex.com"], text: "x" });
      console.log(JSON.stringify({ a: r.accepted, r: r.rejected }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ a: ["good@ex.com"], r: ["bad@ex.com"] });
    expect(exitCode).toBe(0);
  });

  test("should reject when all recipients rejected", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectTo: "only@ex.com" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "only@ex.com", text: "x" });
        console.log("NO_ERROR");
      } catch(e) { console.log("ERR:" + e.message); }
      c.close(); server.stop();
    `);
    expect(stdout).toContain("ERR:");
    expect(stdout).toContain("rejected");
    expect(exitCode).toBe(0);
  });

  test("should authenticate with AUTH PLAIN", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ auth: { user: "u", pass: "p" } });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, auth: { user: "u", pass: "p" } });
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      console.log(JSON.stringify({
        ok: r.accepted.length === 1,
        authed: sessions[0].authed,
        hasAuth: sessions[0].cmds.some(c => c.startsWith("AUTH PLAIN")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(true);
    expect(d.authed).toBe(true);
    expect(d.hasAuth).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should fail with wrong credentials", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ auth: { user: "u", pass: "p" } });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, auth: { user: "u", pass: "wrong" } });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
        console.log("NO_ERROR");
      } catch(e) { console.log("ERR:" + e.message); }
      c.close(); server.stop();
    `);
    expect(stdout).toContain("ERR:");
    expect(stdout).toContain("Authentication failed");
    expect(exitCode).toBe(0);
  });

  test("should send multiple messages over one connection", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      let ehlos = 0, msgs = 0;
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { d: false, b: "" }; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.d) { s.data.b += t; if (s.data.b.includes("\\r\\n.\\r\\n")) { s.data.d = false; msgs++; s.data.b = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) { ehlos++; s.write("250 OK\\r\\n"); }
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.d = true; s.data.b = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      for (let i = 0; i < 5; i++) await c.send({ from: "a@b.com", to: "c@d.com", text: "msg" + i });
      console.log(JSON.stringify({ msgs, ehlos }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.msgs).toBe(5);
    expect(d.ehlos).toBe(1); // single connection
    expect(exitCode).toBe(0);
  });

  test("should verify connection", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.verify();
      console.log(JSON.stringify({
        ok: r != null,
        hasEhlo: sessions[0].cmds.some(c => c.startsWith("EHLO")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(true);
    expect(d.hasEhlo).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should fail verify on bad port", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: 62542 });
      try { await c.verify(); console.log("NO_ERROR"); }
      catch(e) { console.log("ERR"); }
      c.close();
    `);
    expect(stdout).toBe("ERR");
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// ATTACHMENTS (from vendor/nodemailer/test/mail-composer/mail-composer-test.js)
// ============================================================================
describe("Attachments (nodemailer mail-composer-test.js)", () => {
  test("string content base64 encoded", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "t.txt", content: "Hello!" }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        b64: m.includes(Buffer.from("Hello!").toString("base64")),
        fn: m.includes('filename="t.txt"'),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ b64: true, fn: true });
    expect(exitCode).toBe(0);
  });

  test("Buffer content base64 encoded", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const buf = Buffer.from([0x00, 0x01, 0xFF, 0xFE]);
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "d.bin", content: buf }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        b64: m.includes(buf.toString("base64")),
        octet: m.includes("application/octet-stream"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ b64: true, octet: true });
    expect(exitCode).toBe(0);
  });

  test("MIME type detection from extension", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x", attachments: [
        { filename: "i.png", content: "x" },
        { filename: "d.pdf", content: "x" },
      ] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({ png: m.includes("image/png"), pdf: m.includes("application/pdf") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ png: true, pdf: true });
    expect(exitCode).toBe(0);
  });

  test("custom contentType overrides detection", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "d.xyz", content: "x", contentType: "application/x-custom" }] });
      console.log(JSON.stringify({ custom: sessions[0].msg.includes("application/x-custom") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).custom).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("file path attachment", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const tmp = require("path").join(require("os").tmpdir(), "bun-smtp-test-" + Date.now() + ".txt");
      require("fs").writeFileSync(tmp, "file data");
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "f.txt", path: tmp }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        b64: m.includes(Buffer.from("file data").toString("base64")),
        fn: m.includes('filename="f.txt"'),
      }));
      require("fs").unlinkSync(tmp);
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ b64: true, fn: true });
    expect(exitCode).toBe(0);
  });

  test("data URI attachment", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const b64 = Buffer.from("hello data").toString("base64");
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "d.txt", path: "data:text/plain;base64," + b64 }] });
      console.log(JSON.stringify({ has: sessions[0].msg.includes(b64) }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).has).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// DATE HEADER
// ============================================================================
describe("Date Header", () => {
  test("should use current year, not hardcoded", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      const date = sessions[0].msg.split("\\r\\n").find(l => l.startsWith("Date:"));
      console.log(JSON.stringify({ hasYear: date.includes(String(new Date().getUTCFullYear())) }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasYear).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// CUSTOM HEADERS & MESSAGE-ID
// ============================================================================
describe("Headers", () => {
  test("custom headers included", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        headers: { "X-Custom": "val", "X-Priority": "1" } });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        custom: m.includes("X-Custom: val"),
        pri: m.includes("X-Priority: 1"),
        xm: m.includes("X-Mailer: Bun"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout)).toEqual({ custom: true, pri: true, xm: true });
    expect(exitCode).toBe(0);
  });

  test("Message-ID format", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      const mid = sessions[0].msg.split("\\r\\n").find(l => l.startsWith("Message-ID:"));
      console.log(JSON.stringify({ ok: /Message-ID: <[a-f0-9]+@bun>/.test(mid) }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("custom hostname in Message-ID", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, hostname: "example.com" });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      const mid = sessions[0].msg.split("\\r\\n").find(l => l.startsWith("Message-ID:"));
      console.log(JSON.stringify({ ok: mid.includes("@example.com>") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("Reply-To header", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", replyTo: "reply@test.com", text: "x" });
      console.log(JSON.stringify({ ok: sessions[0].msg.includes("Reply-To: reply@test.com") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).ok).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// TLS OPTIONS (from vendor/nodemailer/test/smtp-connection/smtp-connection-test.js)
// ============================================================================
describe("TLS Options (nodemailer smtp-connection-test.js)", () => {
  test("ignoreTLS prevents STARTTLS", async () => {
    const { stdout, exitCode } = await run(`
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { d: false, b: "" }; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.d) { s.data.b += t; if (s.data.b.includes("\\r\\n.\\r\\n")) { s.data.d = false; s.data.b = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250-mock\\r\\n250-STARTTLS\\r\\n250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.d = true; s.data.b = ""; s.write("354 Go\\r\\n"); }
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, ignoreTLS: true });
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      console.log(JSON.stringify({ ok: r.accepted.length === 1, secure: c.secure }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(true);
    expect(d.secure).toBe(false);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// SIZE EXTENSION
// ============================================================================
describe("SIZE Extension", () => {
  test("includes SIZE in MAIL FROM", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      const mf = sessions[0].cmds.find(c => c.startsWith("MAIL FROM:"));
      console.log(JSON.stringify({ hasSize: /SIZE=\\d+/.test(mf) }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSize).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// ERROR CODES (from vendor/nodemailer/test/errors/errors-test.js)
// ============================================================================
describe("Error Codes (nodemailer errors-test.js)", () => {
  test("auth failure should have code EAUTH", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ auth: { user: "u", pass: "p" } });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, auth: { user: "u", pass: "wrong" } });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      } catch(e) { console.log(JSON.stringify({ code: e.code, msg: e.message })); }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.code).toBe("EAUTH");
    expect(d.msg).toContain("Authentication failed");
    expect(exitCode).toBe(0);
  });

  test("rejected sender should have code EENVELOPE", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectFrom: true });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      } catch(e) { console.log(JSON.stringify({ code: e.code })); }
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).code).toBe("EENVELOPE");
    expect(exitCode).toBe(0);
  });

  test("all recipients rejected should have code EENVELOPE", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectTo: "only@ex.com" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "only@ex.com", text: "x" });
      } catch(e) { console.log(JSON.stringify({ code: e.code })); }
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).code).toBe("EENVELOPE");
    expect(exitCode).toBe(0);
  });

  test("connection failure should have code ECONNECTION", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: 62542 });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      } catch(e) { console.log(JSON.stringify({ code: e.code })); }
      c.close();
    `);
    expect(JSON.parse(stdout).code).toBe("ECONNECTION");
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// ENVELOPE OVERRIDE (from vendor/nodemailer/test/mail-composer/mail-composer-test.js)
// ============================================================================
describe("Envelope Override", () => {
  test("envelope.from overrides message from for SMTP", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "header@visible.com",
        to: "header-to@visible.com",
        envelope: { from: "real@sender.com", to: ["real@recipient.com"] },
        text: "envelope test",
      });
      const cmds = sessions[0].cmds;
      const mf = cmds.find(c => c.startsWith("MAIL FROM:"));
      const rt = cmds.filter(c => c.startsWith("RCPT TO:"));
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        envFrom: mf,
        envToCount: rt.length,
        envTo: rt[0],
        headerFrom: m.split("\\r\\n").find(l => l.startsWith("From:")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    // Envelope should use the override
    expect(d.envFrom).toContain("<real@sender.com>");
    expect(d.envToCount).toBe(1);
    expect(d.envTo).toBe("RCPT TO:<real@recipient.com>");
    // Headers should still show the original
    expect(d.headerFrom).toContain("header@visible.com");
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// RFC 5987 FILENAME ENCODING
// ============================================================================
describe("RFC 5987 Filename Encoding (nodemailer mime-funcs-test.js)", () => {
  test("non-ASCII filename uses RFC 5987 encoding", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "tëst dôc.pdf", content: "x" }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        hasRfc5987: m.includes("filename*=utf-8''"),
        hasPercent: m.includes("%"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasRfc5987).toBe(true);
    expect(d.hasPercent).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("ASCII filename with spaces gets quoted", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "my document.pdf", content: "x" }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        quoted: m.includes('filename="my document.pdf"'),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).quoted).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// CUSTOM CONTENT TRANSFER ENCODING (from mail-composer-test.js)
// ============================================================================
describe("Custom Content-Transfer-Encoding (nodemailer mail-composer-test.js)", () => {
  test("contentTransferEncoding: '7bit' uses 7bit", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "t.bin", content: "hello", contentTransferEncoding: "7bit" }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        has7bit: m.includes("Content-Transfer-Encoding: 7bit"),
        rawContent: m.includes("hello"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.has7bit).toBe(true);
    expect(d.rawContent).toBe(true); // Not base64 encoded
    expect(exitCode).toBe(0);
  });

  test("message/rfc822 attachment defaults to 8bit", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "fwd.eml", content: "Subject: test\\r\\n\\r\\nbody", contentType: "message/rfc822" }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        has8bit: m.includes("Content-Transfer-Encoding: 8bit"),
        hasRfc822: m.includes("message/rfc822"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.has8bit).toBe(true);
    expect(d.hasRfc822).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("filename: false omits filename from headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ content: "data", filename: false }] });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        noFilename: !m.includes("filename="),
        hasDisposition: m.includes("Content-Disposition: attachment"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.noFilename).toBe(true);
    expect(d.hasDisposition).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// ADDRESS PARSER (from vendor/nodemailer/test/addressparser/addressparser-test.js)
// ============================================================================
describe("Address Parser (nodemailer addressparser-test.js)", () => {
  // Helper to test address parsing via static method
  async function parseAddr(input: string) {
    const { stdout, exitCode } = await run(`
      console.log(JSON.stringify(Bun.SMTPClient.parseAddress(${JSON.stringify(input)})));
    `);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test("single address", async () => {
    const r = await parseAddr("andris@tr.ee");
    expect(r).toHaveLength(1);
    expect(r[0].address).toBe("andris@tr.ee");
    expect(r[0].name).toBe("");
  });

  test("multiple addresses", async () => {
    const r = await parseAddr("andris@tr.ee, andris@example.com");
    expect(r).toHaveLength(2);
    expect(r[0].address).toBe("andris@tr.ee");
    expect(r[1].address).toBe("andris@example.com");
  });

  test("unquoted name", async () => {
    const r = await parseAddr("andris <andris@tr.ee>");
    expect(r[0].name).toBe("andris");
    expect(r[0].address).toBe("andris@tr.ee");
  });

  test("quoted name with comma", async () => {
    const r = await parseAddr('"reinman, andris" <andris@tr.ee>');
    expect(r[0].name).toBe("reinman, andris");
    expect(r[0].address).toBe("andris@tr.ee");
  });

  test("quoted name with semicolon", async () => {
    const r = await parseAddr('"reinman; andris" <andris@tr.ee>');
    expect(r[0].name).toBe("reinman; andris");
    expect(r[0].address).toBe("andris@tr.ee");
  });

  test("name from comment", async () => {
    const r = await parseAddr("andris@tr.ee (andris)");
    expect(r[0].name).toBe("andris");
    expect(r[0].address).toBe("andris@tr.ee");
  });

  test("missing address", async () => {
    const r = await parseAddr("andris");
    expect(r[0].name).toBe("andris");
    expect(r[0].address).toBe("");
  });

  test("empty group", async () => {
    const r = await parseAddr("Undisclosed:;");
    expect(r[0].name).toBe("Undisclosed");
    expect(r[0].group).toHaveLength(0);
  });

  test("address group", async () => {
    const r = await parseAddr("Disclosed:andris@tr.ee, andris@example.com;");
    expect(r[0].name).toBe("Disclosed");
    expect(r[0].group).toHaveLength(2);
    expect(r[0].group[0].address).toBe("andris@tr.ee");
    expect(r[0].group[1].address).toBe("andris@example.com");
  });

  test("semicolon as delimiter", async () => {
    const r = await parseAddr("andris@tr.ee; andris@example.com;");
    expect(r).toHaveLength(2);
  });

  test("unicode in display name", async () => {
    const r = await parseAddr("Jüri Õunapuu <juri@example.com>");
    expect(r[0].name).toBe("Jüri Õunapuu");
    expect(r[0].address).toBe("juri@example.com");
  });

  test("emoji in display name", async () => {
    const r = await parseAddr("🤖 Robot <robot@example.com>");
    expect(r[0].name).toBe("🤖 Robot");
    expect(r[0].address).toBe("robot@example.com");
  });

  test("CJK characters in name", async () => {
    const r = await parseAddr("田中太郎 <tanaka@example.jp>");
    expect(r[0].name).toBe("田中太郎");
    expect(r[0].address).toBe("tanaka@example.jp");
  });

  test("empty string", async () => {
    const r = await parseAddr("");
    expect(r).toHaveLength(0);
  });

  test("special chars in local-part", async () => {
    for (const addr of ["user+tag@example.com", "user.name@example.com", "user_name@example.com"]) {
      const r = await parseAddr(addr);
      expect(r[0].address).toBe(addr);
    }
  });

  test("leading/trailing whitespace", async () => {
    const r = await parseAddr("  user@example.com  ");
    expect(r[0].address).toBe("user@example.com");
  });

  test("multiple subdomains", async () => {
    const r = await parseAddr("user@mail.server.company.example.com");
    expect(r[0].address).toBe("user@mail.server.company.example.com");
  });

  test("apostrophe in name", async () => {
    const r = await parseAddr("O'Neill <oneill@example.com>");
    expect(r[0].name).toBe("O'Neill");
    expect(r[0].address).toBe("oneill@example.com");
  });
});

// ============================================================================
// disableFileAccess (from vendor/nodemailer/test/mail-composer/mail-composer-test.js)
// ============================================================================
describe("disableFileAccess (nodemailer mail-composer-test.js)", () => {
  test("should skip file path attachments when disabled", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, disableFileAccess: true });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        attachments: [{ filename: "f.txt", path: "/etc/passwd" }] });
      const m = sessions[0].msg;
      // File content should NOT be included (file access disabled)
      console.log(JSON.stringify({
        noPasswd: !m.includes("root:"),
        hasText: m.includes("text/plain"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.noPasswd).toBe(true);
    expect(d.hasText).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// keepBcc (from vendor/nodemailer/test/mail-composer/mail-composer-test.js)
// ============================================================================
describe("keepBcc (nodemailer mail-composer-test.js)", () => {
  test("should include Bcc header when keepBcc is true", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, keepBcc: true });
      await c.send({ from: "a@b.com", to: "b@c.com", bcc: "secret@d.com", text: "x" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        hasBcc: m.includes("Bcc:") && m.includes("secret@d.com"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasBcc).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should strip Bcc header by default", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "b@c.com", bcc: "secret@d.com", text: "x" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({ noBcc: !m.includes("Bcc:") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).noBcc).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// URL CONFIG PARSING (from vendor/nodemailer/test/smtp-transport/smtp-tranport-test.js)
// ============================================================================
describe("URL Config Parsing (nodemailer smtp-transport-test.js)", () => {
  test("string constructor: smtp://user:pass@host:port", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient("smtp://testuser:testpass@mail.example.com:587");
      console.log(JSON.stringify({ secure: c.secure }));
      c.close();
    `);
    expect(JSON.parse(stdout).secure).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("string constructor: smtps:// sets secure", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient("smtps://user:pass@smtp.gmail.com:465");
      console.log(JSON.stringify({ secure: c.secure }));
      c.close();
    `);
    expect(JSON.parse(stdout).secure).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("url property in options", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ url: "smtp://u:p@host.com:25" });
      console.log(JSON.stringify({ secure: c.secure }));
      c.close();
    `);
    expect(JSON.parse(stdout).secure).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("URL auth credentials are used for SMTP AUTH", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ auth: { user: "urluser", pass: "urlpass" } });
      const c = new Bun.SMTPClient("smtp://urluser:urlpass@127.0.0.1:" + port);
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      console.log(JSON.stringify({
        ok: r.accepted.length === 1,
        authed: sessions[0].authed,
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(true);
    expect(d.authed).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// PRIORITY HEADERS (from nodemailer mailer/mail-message.js)
// ============================================================================
describe("Priority Headers", () => {
  test("priority: 'high' adds X-Priority and Importance", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "urgent", priority: "high" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        xp: m.includes("X-Priority: 1"),
        imp: m.includes("Importance: High"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.xp).toBe(true);
    expect(d.imp).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("priority: 'low' adds low priority headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "low", priority: "low" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        xp: m.includes("X-Priority: 5"),
        imp: m.includes("Importance: Low"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.xp).toBe(true);
    expect(d.imp).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("no priority: no priority headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "normal" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({ noPriority: !m.includes("X-Priority:") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).noPriority).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// LIST-* HEADERS (from nodemailer mailer/mail-message.js)
// ============================================================================
describe("List-* Headers", () => {
  test("list.unsubscribe adds List-Unsubscribe header", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        list: { unsubscribe: "https://example.com/unsub" } });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        has: m.includes("List-Unsubscribe: <https://example.com/unsub>"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).has).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// LMTP PROTOCOL
// ============================================================================
describe("LMTP Protocol", () => {
  test("lmtp: true sends LHLO instead of EHLO", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { const sess = { cmds: [], msg: "", inData: false, buf: "" }; sessions.push(sess); s.data = sess; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const text = new TextDecoder().decode(raw);
            const sess = s.data;
            if (sess.inData) { sess.buf += text; if (sess.buf.includes("\\r\\n.\\r\\n")) { sess.inData = false; sess.msg = sess.buf.split("\\r\\n.\\r\\n")[0]; sess.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const line of text.split("\\r\\n").filter(l => l)) {
              sess.cmds.push(line);
              if (line.startsWith("LHLO") || line.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (line.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (line.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (line === "DATA") { sess.inData = true; sess.buf = ""; s.write("354 Go\\r\\n"); }
              else if (line.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (line === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, lmtp: true });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "lmtp test" });
      console.log(JSON.stringify({
        hasLHLO: sessions[0].cmds.some(c => c.startsWith("LHLO")),
        noEHLO: !sessions[0].cmds.some(c => c.startsWith("EHLO")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasLHLO).toBe(true);
    expect(d.noEHLO).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// XOAUTH2 TOKEN BUILDING
// ============================================================================
describe("XOAUTH2 Authentication", () => {
  test("builds XOAUTH2 token from user + access token", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { const sess = { cmds: [], authed: false }; sessions.push(sess); s.data = sess; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const text = new TextDecoder().decode(raw);
            for (const line of text.split("\\r\\n").filter(l => l)) {
              s.data.cmds.push(line);
              if (line.startsWith("EHLO")) s.write("250-mock\\r\\n250-AUTH XOAUTH2\\r\\n250 OK\\r\\n");
              else if (line.startsWith("AUTH XOAUTH2 ")) {
                // Decode and verify token format: user=...\\x01auth=Bearer ...\\x01\\x01
                const decoded = Buffer.from(line.slice(13), "base64").toString();
                if (decoded.includes("user=testuser") && decoded.includes("auth=Bearer ya29.token123")) {
                  s.data.authed = true;
                  s.write("235 OK\\r\\n");
                } else s.write("535 Bad\\r\\n");
              }
              else if (line.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (line.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (line === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port,
        auth: { user: "testuser", pass: "ya29.token123", method: "XOAUTH2" } });
      try {
        await c.verify();
        console.log(JSON.stringify({
          authed: sessions[0].authed,
          hasXoauth: sessions[0].cmds.some(c => c.startsWith("AUTH XOAUTH2")),
        }));
      } catch(e) { console.log(JSON.stringify({ error: e.message })); }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.authed).toBe(true);
    expect(d.hasXoauth).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// ============================================================================
// ICAL EVENT (from vendor/nodemailer/test/mail-composer/mail-composer-test.js)
// ============================================================================
describe("iCalEvent (nodemailer mail-composer-test.js)", () => {
  test("string icalEvent creates text/calendar part", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com",
        text: "Meeting invite",
        icalEvent: "BEGIN:VCALENDAR\\nEND:VCALENDAR" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        hasAlt: m.includes("multipart/alternative"),
        hasCal: m.includes("text/calendar"),
        hasMethod: m.includes("method=PUBLISH"),
        hasContent: m.includes("BEGIN:VCALENDAR"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasAlt).toBe(true);
    expect(d.hasCal).toBe(true);
    expect(d.hasMethod).toBe(true);
    expect(d.hasContent).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("object icalEvent with custom method", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com",
        text: "invite", html: "<b>invite</b>",
        icalEvent: { method: "REQUEST", content: "BEGIN:VCALENDAR\\nMETHOD:REQUEST\\nEND:VCALENDAR" } });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        hasCal: m.includes("text/calendar"),
        hasText: m.includes("text/plain"),
        hasHtml: m.includes("text/html"),
        // text should come before html, html before calendar
        order: m.indexOf("text/plain") < m.indexOf("text/html") && m.indexOf("text/html") < m.indexOf("text/calendar"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasCal).toBe(true);
    expect(d.hasText).toBe(true);
    expect(d.hasHtml).toBe(true);
    expect(d.order).toBe(true);
    expect(exitCode).toBe(0);
  });
});
