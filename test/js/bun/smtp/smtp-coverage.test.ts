/**
 * Tests for previously untested code paths in the SMTP client.
 * Each test exercises a specific branch that had zero coverage.
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

// Mock server that can be configured with various behaviors
const MOCK = `
function mock(opts = {}) {
  let msgCount = 0;
  const sessions = [];
  const server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(s) {
        const sess = { cmds: [], msg: "", inData: false, buf: "" };
        sessions.push(sess); s.data = sess;
        if (opts.greeting === false) return; // Don't send greeting (for timeout tests)
        s.write((opts.greeting || "220 mock SMTP") + "\\r\\n");
      },
      data(s, raw) {
        const t = new TextDecoder().decode(raw);
        const sess = s.data;
        if (sess.inData) {
          sess.buf += t;
          if (sess.buf.includes("\\r\\n.\\r\\n")) {
            sess.inData = false; msgCount++;
            sess.msg = sess.buf.split("\\r\\n.\\r\\n")[0]; sess.buf = "";
            if (opts.rejectData) { s.write("554 Message rejected\\r\\n"); }
            else { s.write("250 OK msg #" + msgCount + "\\r\\n"); }
          }
          return;
        }
        for (const l of t.split("\\r\\n").filter(x=>x)) {
          sess.cmds.push(l);
          if (l.startsWith("EHLO")) {
            if (opts.rejectEhlo) { s.write("502 Not implemented\\r\\n"); }
            else if (opts.ehlo421) { s.write("421 Service closing\\r\\n"); s.end(); }
            else {
              let resp = "250-mock\\r\\n";
              if (opts.ehloLines) resp += opts.ehloLines.map(l => "250-" + l + "\\r\\n").join("");
              if (opts.authMethods) resp += "250-AUTH " + opts.authMethods + "\\r\\n";
              resp += "250 OK\\r\\n";
              s.write(resp);
            }
          }
          else if (l.startsWith("HELO")) s.write("250 OK\\r\\n");
          else if (l.startsWith("AUTH PLAIN")) {
            if (opts.authFail) s.write("535 Auth failed\\r\\n");
            else s.write("235 OK\\r\\n");
          }
          else if (l.startsWith("AUTH LOGIN")) {
            sess.authMethod = "LOGIN";
            s.write("334 VXNlcm5hbWU6\\r\\n");
          }
          else if (l.startsWith("AUTH CRAM-MD5")) {
            if (opts.cramChallenge) s.write("334 " + opts.cramChallenge + "\\r\\n");
            else s.write("334 dGVzdCBjaGFsbGVuZ2U=\\r\\n");
          }
          else if (l.startsWith("AUTH XOAUTH2")) {
            sess.xoauthToken = l.substring(13);
            s.write("235 OK\\r\\n");
          }
          else if (l.startsWith("MAIL FROM:")) s.write("250 OK\\r\\n");
          else if (l.startsWith("RCPT TO:")) {
            const addr = l.match(/<(.+?)>/)?.[1];
            if (opts.rejectTo === addr) s.write("550 Rejected\\r\\n");
            else s.write("250 OK\\r\\n");
          }
          else if (l === "DATA") {
            if (opts.rejectDataCmd) { s.write("421 Too much mail\\r\\n"); }
            else { sess.inData = true; sess.buf = ""; s.write("354 Go\\r\\n"); }
          }
          else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
          else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
          else {
            // For AUTH LOGIN username/password responses
            if (sess.authMethod === "LOGIN") {
              sess.authMethod = "LOGIN_PASS";
              s.write("334 UGFzc3dvcmQ6\\r\\n");
            } else if (sess.authMethod === "LOGIN_PASS") {
              if (opts.authFail) s.write("535 Auth failed\\r\\n");
              else s.write("235 OK\\r\\n");
              sess.authMethod = null;
            } else if (opts.cramResponse) {
              // CRAM-MD5 response
              s.write("235 OK\\r\\n");
            } else {
              s.write("235 OK\\r\\n");
            }
          }
        }
      },
    },
  });
  return { server, sessions, port: server.port, getMsgCount: () => msgCount };
}
`;

describe("Error paths", () => {
  test("should reject on non-220 server greeting", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ greeting: "421 Too busy" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        console.log("ERROR: should have thrown");
      } catch(e) {
        console.log(JSON.stringify({ code: e.code }));
      }
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).code).toBe("EPROTOCOL");
    expect(exitCode).toBe(0);
  });

  test("should reject when DATA command is rejected", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectDataCmd: true });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        console.log("ERROR: should have thrown");
      } catch(e) {
        console.log(JSON.stringify({ code: e.code, msg: e.message }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.msg).toContain("DATA command rejected");
    expect(exitCode).toBe(0);
  });

  test("should reject when message body is rejected after transmission", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectData: true });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        console.log("ERROR: should have thrown");
      } catch(e) {
        console.log(JSON.stringify({ code: e.code, msg: e.message }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.code).toBe("EMESSAGE");
    expect(d.msg).toContain("Message rejected");
    expect(exitCode).toBe(0);
  });

  test("should reject when server sends 421 during EHLO", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ ehlo421: true });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        console.log("ERROR: should have thrown");
      } catch(e) {
        console.log(JSON.stringify({ code: e.code }));
      }
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).code).toBeDefined();
    expect(exitCode).toBe(0);
  });

  test("should reject when message exceeds server SIZE limit", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ ehloLines: ["SIZE 50"] });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "A".repeat(200) });
        console.log("ERROR: should have thrown");
      } catch(e) {
        console.log(JSON.stringify({ code: e.code, msg: e.message }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.code).toBe("EMESSAGE");
    expect(d.msg).toContain("size exceeds");
    expect(exitCode).toBe(0);
  });
});

describe("Auth methods", () => {
  test("should force AUTH LOGIN when method specified", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ authMethods: "PLAIN LOGIN" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, auth: { user: "u", pass: "p", method: "LOGIN" } });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      const usedLogin = sessions[0].cmds.some(c => c.startsWith("AUTH LOGIN"));
      const usedPlain = sessions[0].cmds.some(c => c.startsWith("AUTH PLAIN"));
      console.log(JSON.stringify({ usedLogin, usedPlain }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.usedLogin).toBe(true);
    expect(d.usedPlain).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should send pre-built XOAUTH2 token directly", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ authMethods: "XOAUTH2" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, auth: { user: "u", xoauth2: "my-prebuilt-token" } });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      console.log(JSON.stringify({ token: sessions[0].xoauthToken }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).token).toBe("my-prebuilt-token");
    expect(exitCode).toBe(0);
  });
});

describe("Raw message sending", () => {
  test("should send raw string message without MIME building", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", raw: "Subject: Raw\\r\\n\\r\\nRaw body here" });
      console.log(JSON.stringify({
        hasRaw: sessions[0].msg.includes("Raw body here"),
        hasSubject: sessions[0].msg.includes("Subject: Raw"),
        noMime: !sessions[0].msg.includes("MIME-Version"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasRaw).toBe(true);
    expect(d.hasSubject).toBe(true);
    expect(d.noMime).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should send raw Buffer/ArrayBuffer message", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const rawBytes = new TextEncoder().encode("Subject: Buffer\\r\\n\\r\\nBuffer body");
      await c.send({ from: "a@b.com", to: "c@d.com", raw: rawBytes });
      console.log(JSON.stringify({ hasBody: sessions[0].msg.includes("Buffer body") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasBody).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("verify() method", () => {
  test("should verify connection with auth", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ authMethods: "PLAIN" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, auth: { user: "u", pass: "p" } });
      const result = await c.verify();
      const didAuth = sessions[0].cmds.some(c => c.startsWith("AUTH"));
      console.log(JSON.stringify({ result, didAuth }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.result).toBe(true);
    expect(d.didAuth).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should return true immediately if already connected", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      const result = await c.verify();
      console.log(JSON.stringify({ result }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).result).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("connected/secure getters", () => {
  test("should return connected=true after successful send", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const before = c.connected;
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      const after = c.connected;
      c.close();
      const closed = c.connected;
      console.log(JSON.stringify({ before, after, closed }));
      server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.before).toBe(false);
    expect(d.after).toBe(true);
    expect(d.closed).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should return secure=false for plain connection", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      console.log(JSON.stringify({ secure: c.secure }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).secure).toBe(false);
    expect(exitCode).toBe(0);
  });
});

describe("Bun.SMTPClient.parseAddress()", () => {
  test("should parse simple address", async () => {
    const { stdout, exitCode } = await run(`
      const r = Bun.SMTPClient.parseAddress("John <john@example.com>");
      console.log(JSON.stringify(r));
    `);
    const d = JSON.parse(stdout);
    expect(d).toEqual([{ name: "John", address: "john@example.com" }]);
    expect(exitCode).toBe(0);
  });

  test("should parse comma-separated addresses", async () => {
    const { stdout, exitCode } = await run(`
      const r = Bun.SMTPClient.parseAddress("a@b.com, c@d.com");
      console.log(JSON.stringify(r));
    `);
    const d = JSON.parse(stdout);
    expect(d).toHaveLength(2);
    expect(d[0].address).toBe("a@b.com");
    expect(d[1].address).toBe("c@d.com");
    expect(exitCode).toBe(0);
  });

  test("should flatten groups with { flatten: true }", async () => {
    const { stdout, exitCode } = await run(`
      const r = Bun.SMTPClient.parseAddress("Group: a@b.com, c@d.com;", { flatten: true });
      console.log(JSON.stringify(r));
    `);
    const d = JSON.parse(stdout);
    expect(d).toHaveLength(2);
    expect(d[0].address).toBe("a@b.com");
    expect(d[1].address).toBe("c@d.com");
    expect(exitCode).toBe(0);
  });
});

describe("MIME features", () => {
  test("should include MAIL FROM SIZE parameter when server advertises SIZE", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ ehloLines: ["SIZE 10485760"] });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      const mailFrom = sessions[0].cmds.find(c => c.startsWith("MAIL FROM:"));
      console.log(JSON.stringify({ hasSizeParam: mailFrom?.includes("SIZE=") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSizeParam).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should include custom headers in message", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "hi",
        headers: { "X-Custom-Header": "custom-value", "X-Tracking-ID": "12345" },
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasCustom: msg.includes("X-Custom-Header: custom-value"),
        hasTracking: msg.includes("X-Tracking-ID: 12345"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasCustom).toBe(true);
    expect(d.hasTracking).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should handle multiple list headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "hi",
        list: {
          unsubscribe: "https://example.com/unsubscribe",
          help: "https://example.com/help",
        },
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasUnsub: msg.includes("List-Unsubscribe:"),
        hasHelp: msg.includes("List-Help:"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasUnsub).toBe(true);
    expect(d.hasHelp).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should handle iCalendar with text only (no html)", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com",
        text: "See attached calendar",
        icalEvent: "BEGIN:VCALENDAR\\r\\nEND:VCALENDAR",
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasMultipartAlt: msg.includes("multipart/alternative"),
        hasCalendar: msg.includes("text/calendar"),
        hasPlain: msg.includes("text/plain"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasMultipartAlt).toBe(true);
    expect(d.hasCalendar).toBe(true);
    expect(d.hasPlain).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should include attachment with Content-Disposition", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "hi",
        attachments: [{ filename: "test.pdf", content: "data" }],
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasAttachment: msg.includes("Content-Disposition: attachment"),
        hasFilename: msg.includes("test.pdf"),
        hasMultipart: msg.includes("multipart/mixed"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasAttachment).toBe(true);
    expect(d.hasFilename).toBe(true);
    expect(d.hasMultipart).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Connection lifecycle", () => {
  test("should handle connection timeout when server never responds", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ greeting: false }); // Server accepts but never sends greeting
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, connectionTimeout: 500 });
      const start = Date.now();
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        console.log(JSON.stringify({ threw: false }));
      } catch(e) {
        const elapsed = Date.now() - start;
        console.log(JSON.stringify({ threw: true, code: e.code, timedOut: elapsed >= 400 && elapsed < 5000 }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.threw).toBe(true);
    expect(d.code).toBe("ETIMEDOUT");
    expect(d.timedOut).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Well-known services", () => {
  test("should configure from service name", async () => {
    const { stdout, exitCode } = await run(`
      // Just verify construction with a well-known service doesn't throw
      const c = new Bun.SMTPClient({ service: "Gmail", auth: { user: "u", pass: "p" } });
      console.log(JSON.stringify({ created: true }));
      c.close();
    `);
    expect(JSON.parse(stdout).created).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Envelope override", () => {
  test("should use explicit envelope instead of message headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "header-from@example.com",
        to: "header-to@example.com",
        text: "hi",
        envelope: {
          from: "envelope-from@example.com",
          to: ["envelope-to@example.com"],
        },
      });
      const mailFrom = sessions[0].cmds.find(c => c.startsWith("MAIL FROM:"));
      const rcptTo = sessions[0].cmds.find(c => c.startsWith("RCPT TO:"));
      console.log(JSON.stringify({
        envFrom: mailFrom?.includes("envelope-from@example.com"),
        envTo: rcptTo?.includes("envelope-to@example.com"),
        notHeaderFrom: !mailFrom?.includes("header-from@example.com"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.envFrom).toBe(true);
    expect(d.envTo).toBe(true);
    expect(d.notHeaderFrom).toBe(true);
    expect(exitCode).toBe(0);
  });
});
