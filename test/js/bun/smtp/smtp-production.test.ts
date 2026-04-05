/**
 * Production readiness tests. These test edge cases that would break
 * in real-world usage but pass with toy mock servers.
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

describe("Chunked server responses", () => {
  test("should handle EHLO response split across multiple TCP segments", async () => {
    const { stdout, exitCode } = await run(`
      // Server that sends EHLO response one byte at a time
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) {
            sessions.push({ cmds: [], msg: "", inData: false, buf: "" });
            s.data = sessions[sessions.length - 1];
            // Send greeting in two chunks
            s.write("220 ");
            queueMicrotask(() => s.write("mock ready\\r\\n"));
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
              if (l.startsWith("EHLO")) {
                // Send multiline EHLO response in separate writes
                s.write("250-mock\\r\\n");
                queueMicrotask(() => {
                  s.write("250-AUTH PLAIN\\r\\n");
                  queueMicrotask(() => s.write("250 SIZE 1000000\\r\\n"));
                });
              }
              else if (l.startsWith("AUTH")) s.write("235 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { sess.inData = true; sess.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, auth: { user: "u", pass: "p" } });
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "chunked test" });
      console.log(JSON.stringify({ accepted: r.accepted }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).accepted).toEqual(["c@d.com"]);
    expect(exitCode).toBe(0);
  });
});

describe("Null bytes and malicious input", () => {
  test("should handle null bytes in subject without crashing", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "", msg: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.msg = s.data.buf.slice(0, s.data.buf.indexOf("\\r\\n.\\r\\n")); s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      const r = await c.send({
        from: "a@b.com", to: "c@d.com",
        subject: "Before\\x00After",
        text: "Body with \\x00 null",
      });
      console.log(JSON.stringify({ sent: r.accepted.length === 1 }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).sent).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should handle very long email address without crashing", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      const longLocal = Buffer.alloc(200, "a").toString();
      const r = await c.send({ from: "a@b.com", to: longLocal + "@example.com", text: "long addr" });
      console.log(JSON.stringify({ sent: r.accepted.length === 1 }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).sent).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Auth credential encoding", () => {
  test("should encode passwords with special chars in AUTH PLAIN", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { cmds: [], inData: false, buf: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              s.data.cmds.push(l);
              if (l.startsWith("EHLO")) s.write("250-mock\\r\\n250-AUTH PLAIN\\r\\n250 OK\\r\\n");
              else if (l.startsWith("AUTH PLAIN")) s.write("235 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({
        host: "127.0.0.1", port: server.port,
        auth: { user: "user@domain.com", pass: "p@ss=w0rd!" },
      });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "test" });
      // Verify the AUTH PLAIN credential was properly base64 encoded
      const authCmd = sessions[0].cmds.find(c => c.startsWith("AUTH PLAIN "));
      const decoded = Buffer.from(authCmd.slice(11), "base64").toString("binary");
      // AUTH PLAIN format: \\0user\\0pass
      const parts = decoded.split("\\0");
      console.log(JSON.stringify({
        user: parts[1],
        pass: parts[2],
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.user).toBe("user@domain.com");
    expect(d.pass).toBe("p@ss=w0rd!");
    expect(exitCode).toBe(0);
  });
});

describe("Many recipients", () => {
  test("should handle 20 recipients with correct accepted/rejected tracking", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const rejectList = ["r3@x.com", "r7@x.com", "r15@x.com"];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT TO:")) {
                const addr = l.match(/<(.+?)>/)?.[1];
                if (rejectList.includes(addr)) s.write("550 Rejected\\r\\n");
                else s.write("250 OK\\r\\n");
              }
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      const recipients = [];
      for (let i = 0; i < 20; i++) recipients.push("r" + i + "@x.com");
      const r = await c.send({ from: "a@b.com", to: recipients, text: "many" });
      console.log(JSON.stringify({
        acceptedCount: r.accepted.length,
        rejectedCount: r.rejected.length,
        rejected: r.rejected.sort(),
        total: r.accepted.length + r.rejected.length,
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.acceptedCount).toBe(17);
    expect(d.rejectedCount).toBe(3);
    expect(d.rejected).toEqual(["r15@x.com", "r3@x.com", "r7@x.com"]);
    expect(d.total).toBe(20);
    expect(exitCode).toBe(0);
  });
});

describe("Empty/edge-case fields", () => {
  test("should send email with empty subject", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "", msg: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.msg = s.data.buf.slice(0, s.data.buf.indexOf("\\r\\n.\\r\\n")); s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      const r = await c.send({ from: "a@b.com", to: "c@d.com", subject: "", text: "no subject" });
      console.log(JSON.stringify({ sent: r.accepted.length === 1, hasBody: sessions[0].msg.includes("no subject") }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.sent).toBe(true);
    expect(d.hasBody).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should send email with no subject at all", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "", msg: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.msg = s.data.buf.slice(0, s.data.buf.indexOf("\\r\\n.\\r\\n")); s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      // No subject field at all
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "body only" });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        sent: r.accepted.length === 1,
        noSubject: !msg.includes("Subject:"),
        hasBody: msg.includes("body only"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.sent).toBe(true);
    expect(d.hasBody).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Connection drop during DATA", () => {
  test("should reject promise when server disconnects during message body", async () => {
    const { stdout, exitCode } = await run(`
      let dataReceived = false;
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false }; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) {
              // Server crashes after receiving some data
              dataReceived = true;
              s.end(); // Abrupt disconnect!
              return;
            }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.write("354 Go\\r\\n"); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, connectionTimeout: 3000 });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "will be interrupted" });
        console.log(JSON.stringify({ error: false }));
      } catch(e) {
        console.log(JSON.stringify({ error: true, code: e.code }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.error).toBe(true);
    expect(d.code).toBe("ECONNECTION");
    expect(exitCode).toBe(0);
  });
});

describe("Binary attachment data", () => {
  test("should handle binary Uint8Array attachment correctly", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "", msg: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.msg = s.data.buf.slice(0, s.data.buf.indexOf("\\r\\n.\\r\\n")); s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      // Create binary data with all byte values 0-255
      const binary = new Uint8Array(256);
      for (let i = 0; i < 256; i++) binary[i] = i;
      const r = await c.send({
        from: "a@b.com", to: "c@d.com", text: "see attached",
        attachments: [{ filename: "binary.bin", content: binary }],
      });
      const msg = sessions[0].msg;
      // The binary content should be base64-encoded in the message
      const expectedB64 = Buffer.from(binary).toString("base64");
      console.log(JSON.stringify({
        sent: r.accepted.length === 1,
        hasBase64: msg.includes(expectedB64) || msg.includes(expectedB64.slice(0, 40)),
        hasFilename: msg.includes("binary.bin"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.sent).toBe(true);
    expect(d.hasFilename).toBe(true);
    expect(d.hasBase64).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Large message", () => {
  test("should send 50KB text message without corruption", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "", msg: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.msg = s.data.buf.slice(0, s.data.buf.indexOf("\\r\\n.\\r\\n")); s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) s.write("250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      // 50KB of text with a unique marker at the end
      const bigText = Buffer.alloc(50000, "X").toString() + "ENDMARKER";
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: bigText });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        sent: r.accepted.length === 1,
        hasMarker: msg.includes("ENDMARKER"),
        msgLen: msg.length,
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.sent).toBe(true);
    expect(d.hasMarker).toBe(true);
    expect(d.msgLen).toBeGreaterThan(50000);
    expect(exitCode).toBe(0);
  });
});
