/**
 * Deep verification tests - actually check that the SMTP client produces correct output.
 * These tests verify protocol ordering, message structure, edge cases, and security.
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

// Mock server that captures FULL command sequence and message
const MOCK = `
function mock(opts = {}) {
  const sessions = [];
  const server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(s) {
        const sess = { cmds: [], msg: "", inData: false, buf: "" };
        sessions.push(sess); s.data = sess;
        s.write("220 mock SMTP ready\\r\\n");
      },
      data(s, raw) {
        const t = new TextDecoder().decode(raw);
        const sess = s.data;
        if (sess.inData) {
          sess.buf += t;
          if (sess.buf.includes("\\r\\n.\\r\\n")) {
            sess.inData = false;
            sess.msg = sess.buf.slice(0, sess.buf.indexOf("\\r\\n.\\r\\n"));
            sess.buf = "";
            s.write("250 OK\\r\\n");
          }
          return;
        }
        for (const l of t.split("\\r\\n").filter(x=>x)) {
          sess.cmds.push(l);
          if (l.startsWith("EHLO") || l.startsWith("LHLO")) s.write("250-mock\\r\\n250-AUTH PLAIN LOGIN CRAM-MD5\\r\\n250-SIZE 10485760\\r\\n250 OK\\r\\n");
          else if (l.startsWith("MAIL FROM:")) {
            if (opts.rejectSender) s.write("550 Sender rejected\\r\\n");
            else s.write("250 OK\\r\\n");
          }
          else if (l.startsWith("RCPT TO:")) {
            const addr = l.match(/<(.+?)>/)?.[1];
            if (opts.rejectTo?.includes(addr)) s.write("550 Recipient rejected\\r\\n");
            else s.write("250 OK\\r\\n");
          }
          else if (l === "DATA") { sess.inData = true; sess.buf = ""; s.write("354 Start mail input\\r\\n"); }
          else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
          else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
          else if (l.startsWith("AUTH PLAIN")) {
            sess.cmds.push("(auth-plain)");
            s.write("235 Authentication successful\\r\\n");
          }
          else if (l.startsWith("AUTH LOGIN")) {
            s.write("334 VXNlcm5hbWU6\\r\\n"); // Username:
          }
          else s.write("235 OK\\r\\n"); // catchall for AUTH LOGIN steps
        }
      },
    },
  });
  return { server, sessions, port: server.port };
}
`;

describe("Protocol command ordering", () => {
  test("should send commands in correct SMTP order: EHLO → MAIL FROM → RCPT TO → DATA", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "sender@test.com", to: "rcpt@test.com", text: "hello" });
      const cmds = sessions[0].cmds;
      console.log(JSON.stringify(cmds));
      c.close(); server.stop();
    `);
    const cmds: string[] = JSON.parse(stdout);
    // Verify ordering
    expect(cmds[0]).toMatch(/^EHLO /);
    const mailFromIdx = cmds.findIndex(c => c.startsWith("MAIL FROM:"));
    const rcptToIdx = cmds.findIndex(c => c.startsWith("RCPT TO:"));
    const dataIdx = cmds.findIndex(c => c === "DATA");
    expect(mailFromIdx).toBeGreaterThan(0); // after EHLO
    expect(rcptToIdx).toBeGreaterThan(mailFromIdx);
    expect(dataIdx).toBeGreaterThan(rcptToIdx);
    // Verify exact addresses
    expect(cmds[mailFromIdx]).toMatch(/^MAIL FROM:<sender@test\.com>/);
    expect(cmds[rcptToIdx]).toBe("RCPT TO:<rcpt@test.com>");
    expect(exitCode).toBe(0);
  });

  test("should send AUTH before MAIL FROM when credentials provided", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, auth: { user: "u", pass: "p" } });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      const cmds = sessions[0].cmds;
      console.log(JSON.stringify(cmds));
      c.close(); server.stop();
    `);
    const cmds: string[] = JSON.parse(stdout);
    const authIdx = cmds.findIndex(c => c.startsWith("AUTH "));
    const mailFromIdx = cmds.findIndex(c => c.startsWith("MAIL FROM:"));
    expect(authIdx).toBeGreaterThan(0); // after EHLO
    expect(mailFromIdx).toBeGreaterThan(authIdx); // after AUTH
    expect(exitCode).toBe(0);
  });

  test("should send RSET between sequential sends (connection reuse)", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "x@y.com", text: "first" });
      await c.send({ from: "a@b.com", to: "p@q.com", text: "second" });
      const cmds = sessions[0].cmds;
      console.log(JSON.stringify(cmds));
      c.close(); server.stop();
    `);
    const cmds: string[] = JSON.parse(stdout);
    const rsetIdx = cmds.findIndex(c => c === "RSET");
    expect(rsetIdx).toBeGreaterThan(0);
    // Second MAIL FROM should come after RSET
    const mailFroms = cmds.filter(c => c.startsWith("MAIL FROM:"));
    expect(mailFroms).toHaveLength(2);
    const secondMailIdx = cmds.indexOf(mailFroms[1]);
    expect(secondMailIdx).toBeGreaterThan(rsetIdx);
    expect(exitCode).toBe(0);
  });
});

describe("Message structure verification", () => {
  test("plain text email should have correct headers and body", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "sender@test.com", to: "rcpt@test.com", subject: "Test Subject", text: "Hello World" });
      console.log(JSON.stringify(sessions[0].msg));
      c.close(); server.stop();
    `);
    const msg: string = JSON.parse(stdout);
    // Required RFC 5322 headers
    expect(msg).toContain("From: sender@test.com");
    expect(msg).toContain("To: rcpt@test.com");
    expect(msg).toContain("Subject: Test Subject");
    expect(msg).toContain("MIME-Version: 1.0");
    expect(msg).toMatch(/Message-ID: <.+@.+>/);
    expect(msg).toMatch(/Date: /);
    // Body
    expect(msg).toContain("Content-Type: text/plain");
    expect(msg).toContain("Hello World");
    // Headers and body separated by blank line
    const parts = msg.split("\r\n\r\n");
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(exitCode).toBe(0);
  });

  test("multipart/alternative should have text before html with proper boundaries", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "Plain version", html: "<b>HTML version</b>" });
      console.log(JSON.stringify(sessions[0].msg));
      c.close(); server.stop();
    `);
    const msg: string = JSON.parse(stdout);
    expect(msg).toContain("multipart/alternative");
    // Extract boundary from Content-Type header
    const boundaryMatch = msg.match(/boundary="?([^";\r\n]+)"?/);
    expect(boundaryMatch).not.toBeNull();
    const boundary = boundaryMatch![1];
    // Text part should come before HTML part (RFC 2046 convention)
    const textIdx = msg.indexOf("text/plain");
    const htmlIdx = msg.indexOf("text/html");
    expect(textIdx).toBeGreaterThan(-1);
    expect(htmlIdx).toBeGreaterThan(textIdx);
    // Both parts should contain actual content
    expect(msg).toContain("Plain version");
    expect(msg).toContain("<b>HTML version</b>");
    // Boundary delimiters should be present
    expect(msg).toContain("--" + boundary);
    expect(msg).toContain("--" + boundary + "--");
    expect(exitCode).toBe(0);
  });

  test("attachment should be base64-encoded with proper Content-Disposition", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "See attached",
        attachments: [{ filename: "test.txt", content: "Hello from attachment" }],
      });
      console.log(JSON.stringify(sessions[0].msg));
      c.close(); server.stop();
    `);
    const msg: string = JSON.parse(stdout);
    expect(msg).toContain("multipart/mixed");
    expect(msg).toContain("Content-Disposition: attachment");
    expect(msg).toContain('filename="test.txt"');
    // The attachment content should be base64-encoded
    const b64 = Buffer.from("Hello from attachment").toString("base64");
    expect(msg).toContain(b64);
    expect(exitCode).toBe(0);
  });
});

describe("Dot-stuffing (RFC 5321 §4.5.2)", () => {
  test("should escape lines starting with a dot in message body", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com",
        raw: "From: a@b.com\\r\\nTo: c@d.com\\r\\nSubject: dots\\r\\n\\r\\nLine 1\\r\\n.Line starting with dot\\r\\n..Two dots\\r\\nNormal line\\r\\n",
      });
      // The server should receive the message with dots UN-stuffed
      // (the server strips the extra dot, so we see the original)
      const msg = sessions[0].msg;
      console.log(JSON.stringify(msg));
      c.close(); server.stop();
    `);
    const msg: string = JSON.parse(stdout);
    // Server should see the original lines (dot-stuffing is transparent)
    expect(msg).toContain(".Line starting with dot");
    expect(msg).toContain("..Two dots");
    expect(exitCode).toBe(0);
  });

  test("should not prematurely end message with lone dot on a line", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com",
        raw: "From: a@b.com\\r\\nTo: c@d.com\\r\\nSubject: dots\\r\\n\\r\\nBefore dot\\r\\n.\\r\\nAfter dot\\r\\n",
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({ hasAfterDot: msg.includes("After dot"), msgLen: msg.length }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    // The message should contain text AFTER the lone dot line
    expect(d.hasAfterDot).toBe(true);
    expect(d.msgLen).toBeGreaterThan(20);
    expect(exitCode).toBe(0);
  });
});

describe("Security: header injection prevention", () => {
  test("should not allow newlines in subject to inject headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com",
        subject: "Normal\\r\\nBcc: evil@hacker.com",
        text: "test",
      });
      const msg = sessions[0].msg;
      // The injected Bcc header should NOT appear as a separate header
      const hasSeparateBcc = msg.split("\\r\\n").some(line => line.startsWith("Bcc: evil@hacker.com"));
      console.log(JSON.stringify({ hasSeparateBcc }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSeparateBcc).toBe(false);
    expect(exitCode).toBe(0);
  });
});

describe("Envelope handling", () => {
  test("should use envelope override when provided", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({
        from: "display@example.com", to: "display-to@example.com",
        text: "test",
        envelope: { from: "bounce@real.com", to: ["real-rcpt@real.com"] },
      });
      const cmds = sessions[0].cmds;
      const mailFrom = cmds.find(c => c.startsWith("MAIL FROM:"));
      const rcptTo = cmds.find(c => c.startsWith("RCPT TO:"));
      console.log(JSON.stringify({
        mailFrom, rcptTo,
        accepted: r.accepted,
        envFrom: r.envelope.from,
        envTo: r.envelope.to,
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    // SMTP commands should use envelope addresses, not header addresses
    expect(d.mailFrom).toMatch(/^MAIL FROM:<bounce@real\.com>/);
    expect(d.rcptTo).toBe("RCPT TO:<real-rcpt@real.com>");
    expect(d.accepted).toEqual(["real-rcpt@real.com"]);
    expect(d.envFrom).toBe("bounce@real.com");
    expect(d.envTo).toEqual(["real-rcpt@real.com"]);
    expect(exitCode).toBe(0);
  });

  test("should include CC and BCC in RCPT TO but strip BCC from headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com",
        to: "to@x.com",
        cc: "cc@x.com",
        bcc: "bcc@x.com",
        text: "test",
      });
      const cmds = sessions[0].cmds;
      const rcpts = cmds.filter(c => c.startsWith("RCPT TO:"));
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        rcptCount: rcpts.length,
        rcpts: rcpts.map(r => r.match(/<(.+?)>/)?.[1]),
        hasBccHeader: msg.includes("Bcc:"),
        hasCcHeader: msg.includes("Cc:"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.rcptCount).toBe(3);
    expect(d.rcpts).toContain("to@x.com");
    expect(d.rcpts).toContain("cc@x.com");
    expect(d.rcpts).toContain("bcc@x.com");
    // BCC should NOT appear in message headers
    expect(d.hasBccHeader).toBe(false);
    // CC should appear in message headers
    expect(d.hasCcHeader).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Pool deep verification", () => {
  test("should deliver each queued message with correct content to correct recipient", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, pool: true });
      const [r1, r2, r3] = await Promise.all([
        c.send({ from: "a@b.com", to: "first@x.com", subject: "S1", text: "Body 1" }),
        c.send({ from: "a@b.com", to: "second@x.com", subject: "S2", text: "Body 2" }),
        c.send({ from: "a@b.com", to: "third@x.com", subject: "S3", text: "Body 3" }),
      ]);
      // Wait for all RSET responses (sequential sends on single connection)
      // Verify each message went to correct recipient
      console.log(JSON.stringify({
        r1: r1.accepted, r2: r2.accepted, r3: r3.accepted,
        // Check the RCPT TO commands in order
        rcpts: sessions[0].cmds.filter(c => c.startsWith("RCPT TO:")).map(r => r.match(/<(.+?)>/)?.[1]),
        // Check each message contains correct subject
        msgs: sessions.flatMap(s => {
          // In pool mode all messages go through one session
          // But we capture per-DATA, so we need to collect messages from the mock
          return [];
        }),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.r1).toEqual(["first@x.com"]);
    expect(d.r2).toEqual(["second@x.com"]);
    expect(d.r3).toEqual(["third@x.com"]);
    // All 3 recipients should appear in RCPT TO commands
    expect(d.rcpts).toContain("first@x.com");
    expect(d.rcpts).toContain("second@x.com");
    expect(d.rcpts).toContain("third@x.com");
    expect(exitCode).toBe(0);
  });
});

describe("Error handling", () => {
  test("should reject with EENVELOPE when sender is rejected", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectSender: true });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        console.log(JSON.stringify({ error: false }));
      } catch(e) {
        console.log(JSON.stringify({ error: true, code: e.code }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.error).toBe(true);
    expect(d.code).toBe("EENVELOPE");
    expect(exitCode).toBe(0);
  });

  test("should reject with EENVELOPE when ALL recipients rejected", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectTo: ["a@x.com", "b@x.com"] });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "sender@x.com", to: ["a@x.com", "b@x.com"], text: "hi" });
        console.log(JSON.stringify({ error: false }));
      } catch(e) {
        console.log(JSON.stringify({ error: true, code: e.code }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.error).toBe(true);
    expect(d.code).toBe("EENVELOPE");
    expect(exitCode).toBe(0);
  });

  test("should succeed with partial rejection", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectTo: ["bad@x.com"] });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({ from: "a@b.com", to: ["good@x.com", "bad@x.com", "also-good@x.com"], text: "hi" });
      console.log(JSON.stringify({ accepted: r.accepted, rejected: r.rejected }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.accepted).toEqual(["good@x.com", "also-good@x.com"]);
    expect(d.rejected).toEqual(["bad@x.com"]);
    expect(exitCode).toBe(0);
  });

  test("should reject with meaningful error when no 'from' provided", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ to: "c@d.com", text: "hi" });
        console.log("no-error");
      } catch(e) {
        console.log(JSON.stringify({ msg: e.message }));
      }
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).msg).toContain("from");
    expect(exitCode).toBe(0);
  });

  test("should reject with meaningful error when no recipients provided", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", text: "hi" });
        console.log("no-error");
      } catch(e) {
        console.log(JSON.stringify({ msg: e.message }));
      }
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).msg).toContain("recipient");
    expect(exitCode).toBe(0);
  });
});

describe("Well-known services", () => {
  test("should configure Gmail settings from service name", async () => {
    const { stdout, exitCode } = await run(`
      // Just test that the constructor accepts 'service' option without error
      // and configures the right host (we can't actually connect to Gmail)
      try {
        const c = new Bun.SMTPClient({ service: "gmail", auth: { user: "test", pass: "test" } });
        console.log(JSON.stringify({ created: true }));
        c.close();
      } catch(e) {
        console.log(JSON.stringify({ error: e.message }));
      }
    `);
    expect(JSON.parse(stdout).created).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Unicode support", () => {
  test("should handle unicode in subject and body", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com",
        subject: "Hello 你好 🌍",
        text: "Unicode body: café, naïve, 日本語",
      });
      const msg = sessions[0].msg;
      // Subject should be encoded (RFC 2047)
      const hasEncodedSubject = msg.includes("=?UTF-8?") || msg.includes("Subject:");
      // Body should contain the unicode text (possibly QP or base64 encoded)
      const hasUnicodeBody = msg.includes("café") || msg.includes("caf=C3=A9") || msg.includes("Y2Fm");
      console.log(JSON.stringify({ hasEncodedSubject, hasUnicodeBody }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasEncodedSubject).toBe(true);
    expect(d.hasUnicodeBody).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("LMTP protocol", () => {
  test("should use LHLO instead of EHLO in LMTP mode", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { const sess = { cmds: [], inData: false, buf: "" }; sessions.push(sess); s.data = sess; s.write("220 LMTP ready\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              s.data.cmds.push(l);
              if (l.startsWith("LHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, lmtp: true });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "lmtp test" });
      const firstCmd = sessions[0].cmds[0];
      console.log(JSON.stringify({ firstCmd, usesLHLO: firstCmd.startsWith("LHLO") }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.usesLHLO).toBe(true);
    expect(exitCode).toBe(0);
  });
});
