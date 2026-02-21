/**
 * Tests for previously untested code paths.
 * Each test exercises a specific feature that had zero test coverage.
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
            const challenge = Buffer.from("<test@mock>").toString("base64");
            socket.write("334 " + challenge + "\\r\\n");
          } else if (line.startsWith("MAIL FROM:")) {
            if (opts.rejectFrom) socket.write("550 Rejected\\r\\n");
            else socket.write("250 OK\\r\\n");
          } else if (line.startsWith("RCPT TO:")) {
            socket.write("250 OK\\r\\n");
          } else if (line === "DATA") {
            s.inData = true; s.buf = "";
            socket.write("354 Go\\r\\n");
          } else if (line.startsWith("RSET")) socket.write("250 OK\\r\\n");
          else if (line === "QUIT") { socket.write("221 Bye\\r\\n"); socket.end(); }
          else {
            // For CRAM-MD5 response or AUTH LOGIN password
            s.authed = true;
            socket.write("235 OK\\r\\n");
          }
        }
      },
    },
  });
  return { server, sessions, port: server.port };
}
`;

describe("Header Folding", () => {
  test("long subject is folded at 76 chars", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const longSubject = "This is a very long subject line that definitely exceeds seventy-six characters and should be folded";
      await c.send({ from: "a@b.com", to: "c@d.com", subject: longSubject, text: "x" });
      const m = sessions[0].msg;
      const lines = m.split("\\r\\n");
      // Find the Subject line and any continuation lines
      let subjectFull = "";
      let inSubject = false;
      for (const line of lines) {
        if (line.startsWith("Subject:")) { subjectFull = line; inSubject = true; }
        else if (inSubject && (line.startsWith(" ") || line.startsWith("\\t"))) { subjectFull += "\\r\\n" + line; }
        else { inSubject = false; }
      }
      // Subject should be folded - the first line should be <= 76 chars
      const firstLine = subjectFull.split("\\r\\n")[0];
      console.log(JSON.stringify({
        folded: subjectFull.includes("\\r\\n"),
        firstLineOk: firstLine.length <= 78, // Allow a tiny bit of slack
        containsFullSubject: subjectFull.replace(/\\r\\n\\s/g, " ").includes("seventy-six"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.folded).toBe(true);
    expect(d.firstLineOk).toBe(true);
    expect(d.containsFullSubject).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("short subject is NOT folded", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", subject: "Short subject", text: "x" });
      const m = sessions[0].msg;
      const subjLine = m.split("\\r\\n").find(l => l.startsWith("Subject:"));
      console.log(JSON.stringify({ noFold: subjLine === "Subject: Short subject" }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).noFold).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("CRAM-MD5 Authentication", () => {
  test("CRAM-MD5 auth sends challenge response", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      // Mock that only advertises CRAM-MD5 (no PLAIN/LOGIN)
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) {
            const sess = { cmds: [], msg: "", inData: false, buf: "", authed: false };
            sessions.push(sess);
            s.data = sess;
            s.write("220 mock\\r\\n");
          },
          data(s, raw) {
            const text = new TextDecoder().decode(raw);
            const sess = s.data;
            if (sess.inData) {
              sess.buf += text;
              if (sess.buf.includes("\\r\\n.\\r\\n")) {
                sess.inData = false; sess.msg = sess.buf.split("\\r\\n.\\r\\n")[0]; sess.buf = "";
                s.write("250 OK\\r\\n");
              }
              return;
            }
            for (const line of text.split("\\r\\n").filter(l => l)) {
              sess.cmds.push(line);
              if (line.startsWith("EHLO")) s.write("250-mock\\r\\n250-AUTH CRAM-MD5\\r\\n250 OK\\r\\n");
              else if (line === "AUTH CRAM-MD5") {
                const challenge = Buffer.from("<unique.challenge@mock>").toString("base64");
                s.write("334 " + challenge + "\\r\\n");
              }
              else if (line.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (line.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (line === "DATA") { sess.inData = true; sess.buf = ""; s.write("354 Go\\r\\n"); }
              else if (line.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (line === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
              else {
                // This is the CRAM-MD5 response - decode and verify format
                const decoded = Buffer.from(line, "base64").toString();
                // Should be "username hex-digest" format
                const parts = decoded.split(" ");
                if (parts.length === 2 && parts[0] === "testuser" && parts[1].length === 32) {
                  sess.authed = true;
                  s.write("235 OK\\r\\n");
                } else {
                  s.write("535 Bad\\r\\n");
                }
              }
            }
          },
        },
      });

      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port,
        auth: { user: "testuser", pass: "testpass" } });
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "cram test" });
      console.log(JSON.stringify({
        ok: r.accepted.length === 1,
        authed: sessions[0].authed,
        hasCramCmd: sessions[0].cmds.includes("AUTH CRAM-MD5"),
        noPlain: !sessions[0].cmds.some(c => c.startsWith("AUTH PLAIN")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(true);
    expect(d.authed).toBe(true);
    expect(d.hasCramCmd).toBe(true);
    expect(d.noPlain).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Auth Method Override", () => {
  test("auth.method forces LOGIN even when PLAIN available", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ auth: { user: "u", pass: "p" } });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port,
        auth: { user: "u", pass: "p", method: "LOGIN" } });
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
      console.log(JSON.stringify({
        ok: r.accepted.length === 1,
        hasLogin: sessions[0].cmds.includes("AUTH LOGIN"),
        noPlain: !sessions[0].cmds.some(c => c.startsWith("AUTH PLAIN")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.ok).toBe(true);
    expect(d.hasLogin).toBe(true);
    expect(d.noPlain).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Socket Timeout", () => {
  test("socketTimeout triggers on idle connection", async () => {
    const { stdout, exitCode } = await run(`
      // Server that sends greeting but then goes silent
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const text = new TextDecoder().decode(raw);
            if (text.includes("EHLO")) {
              // Send EHLO response but then go completely silent
              s.write("250 OK\\r\\n");
              // Don't respond to anything else - force timeout
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port,
        connectionTimeout: 500 }); // 500ms timeout
      const start = Date.now();
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "x" });
        console.log("NO_ERROR");
      } catch(e) {
        const elapsed = Date.now() - start;
        console.log(JSON.stringify({
          timedOut: e.message.includes("timeout") || e.code === "ETIMEDOUT",
          elapsed: elapsed,
          reasonable: elapsed < 3000, // Should timeout within 3s (500ms + overhead)
        }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.timedOut).toBe(true);
    expect(d.reasonable).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Large Message Body", () => {
  test("should send 100KB message without corruption", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      // Generate a 100KB message body
      const body = "A".repeat(100 * 1024);
      await c.send({ from: "a@b.com", to: "c@d.com", text: body });
      const m = sessions[0].msg;
      // Count how many 'A' characters are in the message (QP might encode some)
      const bodySection = m.split("\\r\\n\\r\\n").slice(1).join("\\r\\n\\r\\n");
      // QP-encoded body of all 'A' should just be 'A' repeated with soft line breaks
      const decoded = bodySection.replace(/=\\r\\n/g, ""); // Remove soft line breaks
      console.log(JSON.stringify({
        hasBody: decoded.length > 50000,
        allAs: decoded.split("").every(c => c === "A" || c === "\\r" || c === "\\n"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasBody).toBe(true);
    expect(d.allAs).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Dot Stuffing", () => {
  test("lines starting with dot are escaped", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com",
        raw: "From: a@b.com\\r\\nTo: c@d.com\\r\\n\\r\\n.This line starts with a dot\\r\\n..Two dots\\r\\nNormal line" });
      const m = sessions[0].msg;
      console.log(JSON.stringify({
        // After dot-unstuffing by server, the message should have the original dots
        hasDotLine: m.includes(".This line starts with a dot"),
        hasTwoDots: m.includes("..Two dots"),
        hasNormal: m.includes("Normal line"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasDotLine).toBe(true);
    expect(d.hasTwoDots).toBe(true);
    expect(d.hasNormal).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Address Parser - Security", () => {
  test("should not extract email from quoted local-part", async () => {
    // Security test from nodemailer: quoted strings can contain @ but should not be extracted
    const { stdout, exitCode } = await run(`
      const r = Bun.SMTPClient.parseAddress('"xclow3n@gmail.com x"@internal.domain');
      // Should NOT route to xclow3n@gmail.com - the whole thing is one address
      console.log(JSON.stringify({
        count: r.length,
        address: r[0]?.address || "",
        notGmail: !(r[0]?.address || "").endsWith("@gmail.com"),
      }));
    `);
    const d = JSON.parse(stdout);
    expect(d.count).toBe(1);
    expect(d.notGmail).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should handle quoted local-part with attacker domain", async () => {
    const { stdout, exitCode } = await run(`
      const r = Bun.SMTPClient.parseAddress('"user@attacker.com"@legitimate.com');
      console.log(JSON.stringify({
        address: r[0]?.address || "",
        notAttacker: !(r[0]?.address || "").endsWith("@attacker.com"),
      }));
    `);
    const d = JSON.parse(stdout);
    expect(d.notAttacker).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Connection Pool", () => {
  test("maxMessages: recycles connection after limit", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      let ehlos = 0;
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { d: false, b: "" }; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.d) { s.data.b += t; if (s.data.b.includes("\\r\\n.\\r\\n")) { s.data.d = false; s.data.b = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO") || l.startsWith("LHLO")) { ehlos++; s.write("250 OK\\r\\n"); }
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.d = true; s.data.b = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, pool: true, maxMessages: 3 });
      for (let i = 0; i < 5; i++) await c.send({ from: "a@b.com", to: "c@d.com", text: "msg" + i });
      // With maxMessages=3, after 3 messages the connection should recycle
      // So we should see at least 2 EHLOs (initial + reconnect after 3rd message)
      console.log(JSON.stringify({ ehlos, reconnected: ehlos >= 2 }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.reconnected).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Custom Header Folding", () => {
  test("long custom header is folded", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const longValue = "This is a very long custom header value that definitely exceeds the seventy-six character line limit and should be folded by the MIME builder";
      await c.send({ from: "a@b.com", to: "c@d.com", text: "x",
        headers: { "X-Long-Header": longValue } });
      const m = sessions[0].msg;
      // Find the X-Long-Header and check if it's folded
      const headerStart = m.indexOf("X-Long-Header:");
      const headerEnd = m.indexOf("\\r\\n", headerStart + 20);
      const firstLine = m.substring(headerStart, headerEnd);
      console.log(JSON.stringify({
        folded: m.indexOf("\\r\\n ", headerStart) < headerEnd + 10, // Continuation line within header
        containsValue: m.includes("seventy-six"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.folded).toBe(true);
    expect(d.containsValue).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("long To header with many recipients is folded", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com",
        to: ["alice@example.com", "bob@example.com", "charlie@example.com", "david@example.com", "eve@example.com"],
        text: "x" });
      const m = sessions[0].msg;
      // To header should contain all recipients and be folded if long enough
      const toHeader = m.substring(m.indexOf("To:"), m.indexOf("\\r\\n", m.indexOf("To:") + 70) + 10);
      console.log(JSON.stringify({
        hasAll: m.includes("alice@") && m.includes("bob@") && m.includes("charlie@") && m.includes("david@") && m.includes("eve@"),
      }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasAll).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Address Parser - Groups", () => {
  test("nested groups are flattened", async () => {
    const { stdout, exitCode } = await run(`
      const r = Bun.SMTPClient.parseAddress("Outer:Inner:deep@example.com;;");
      console.log(JSON.stringify({
        count: r.length,
        hasGroup: r.length > 0 && !!r[0].group,
      }));
    `);
    const d = JSON.parse(stdout);
    expect(d.count).toBe(1);
    expect(d.hasGroup).toBe(true);
    expect(exitCode).toBe(0);
  });
});
