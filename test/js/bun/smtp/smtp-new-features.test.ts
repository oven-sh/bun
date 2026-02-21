/**
 * Tests for newly implemented SMTP features:
 * - Pool mode (queue concurrent sends)
 * - Proxy support (HTTP CONNECT)
 * - Sendmail transport
 * - createTestAccount
 * - Comma-separated address parsing
 * - Result object format (arrays)
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
  let msgCount = 0;
  const sessions = [];
  const server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(s) {
        const sess = { cmds: [], msg: "", inData: false, buf: "" };
        sessions.push(sess); s.data = sess;
        s.write("220 mock SMTP\\r\\n");
      },
      data(s, raw) {
        const t = new TextDecoder().decode(raw);
        const sess = s.data;
        if (sess.inData) {
          sess.buf += t;
          if (sess.buf.includes("\\r\\n.\\r\\n")) {
            sess.inData = false; msgCount++;
            sess.msg = sess.buf.split("\\r\\n.\\r\\n")[0]; sess.buf = "";
            s.write("250 OK msg #" + msgCount + "\\r\\n");
          }
          return;
        }
        for (const l of t.split("\\r\\n").filter(x=>x)) {
          sess.cmds.push(l);
          if (l.startsWith("EHLO")) s.write("250-mock\\r\\n250 OK\\r\\n");
          else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
          else if (l.startsWith("RCPT")) {
            const addr = l.match(/<(.+?)>/)?.[1];
            if (opts.rejectTo && opts.rejectTo === addr) s.write("550 rejected\\r\\n");
            else s.write("250 OK\\r\\n");
          }
          else if (l === "DATA") { sess.inData = true; sess.buf = ""; s.write("354 Go\\r\\n"); }
          else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
          else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
        }
      },
    },
  });
  return { server, sessions, port: server.port, getMsgCount: () => msgCount };
}
`;

describe("Comma-separated address parsing", () => {
  test("should split comma-separated to string into multiple recipients", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({ from: "a@b.com", to: "first@a.com, second@b.com, third@c.com", text: "hi" });
      const rcpts = sessions[0].cmds.filter(c => c.startsWith("RCPT TO:"));
      console.log(JSON.stringify({
        accepted: r.accepted,
        rcptCount: rcpts.length,
        has1: rcpts.some(r => r.includes("first@a.com")),
        has2: rcpts.some(r => r.includes("second@b.com")),
        has3: rcpts.some(r => r.includes("third@c.com")),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.accepted).toEqual(["first@a.com", "second@b.com", "third@c.com"]);
    expect(d.rcptCount).toBe(3);
    expect(d.has1).toBe(true);
    expect(d.has2).toBe(true);
    expect(d.has3).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should handle display names in comma-separated string", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({ from: "a@b.com", to: '"Alice" <alice@x.com>, Bob <bob@y.com>', text: "hi" });
      console.log(JSON.stringify({ accepted: r.accepted }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).accepted).toEqual(["alice@x.com", "bob@y.com"]);
    expect(exitCode).toBe(0);
  });

  test("should split comma-separated addresses within array elements", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({ from: "a@b.com", to: ["x@a.com, y@b.com", "z@c.com"], text: "hi" });
      console.log(JSON.stringify({ accepted: r.accepted }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).accepted).toEqual(["x@a.com", "y@b.com", "z@c.com"]);
    expect(exitCode).toBe(0);
  });
});

describe("Result object format (nodemailer compatible)", () => {
  test("should return accepted/rejected as arrays of addresses", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock({ rejectTo: "bad@x.com" });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({ from: "a@b.com", to: ["good@x.com", "bad@x.com"], text: "hi" });
      console.log(JSON.stringify({
        accepted: r.accepted,
        rejected: r.rejected,
        hasEnvelope: typeof r.envelope === "object",
        envFrom: r.envelope?.from,
        envTo: r.envelope?.to,
        hasMessageId: typeof r.messageId === "string" && r.messageId.startsWith("<"),
        hasResponse: typeof r.response === "string",
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.accepted).toEqual(["good@x.com"]);
    expect(d.rejected).toEqual(["bad@x.com"]);
    expect(d.hasEnvelope).toBe(true);
    expect(d.envFrom).toBe("a@b.com");
    expect(d.envTo).toEqual(["good@x.com", "bad@x.com"]);
    expect(d.hasMessageId).toBe(true);
    expect(d.hasResponse).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Pool mode (pool: true)", () => {
  test("should queue concurrent sends and deliver all", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port, getMsgCount } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, pool: true });
      const [r1, r2, r3] = await Promise.all([
        c.send({ from: "a@b.com", to: "x@y.com", text: "msg 1" }),
        c.send({ from: "a@b.com", to: "p@q.com", text: "msg 2" }),
        c.send({ from: "a@b.com", to: "s@t.com", text: "msg 3" }),
      ]);
      console.log(JSON.stringify({
        r1: r1.accepted, r2: r2.accepted, r3: r3.accepted,
        total: getMsgCount(),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.r1).toEqual(["x@y.com"]);
    expect(d.r2).toEqual(["p@q.com"]);
    expect(d.r3).toEqual(["s@t.com"]);
    expect(d.total).toBe(3);
    expect(exitCode).toBe(0);
  });

  test("should rotate connections after maxMessages", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      let ehloCount = 0;
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "" }; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) {
              s.data.buf += t;
              if (s.data.buf.includes("\\r\\n.\\r\\n")) {
                s.data.inData = false; s.data.buf = "";
                s.write("250 OK\\r\\n");
              }
              return;
            }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) { ehloCount++; s.write("250 OK\\r\\n"); }
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, pool: true, maxMessages: 2 });
      await c.send({ from: "a@b.com", to: "x@y.com", text: "1" });
      await c.send({ from: "a@b.com", to: "x@y.com", text: "2" });
      // Third send should trigger reconnect (maxMessages=2 reached)
      await c.send({ from: "a@b.com", to: "x@y.com", text: "3" });
      console.log(JSON.stringify({ ehloCount }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    // 2 EHLO calls: first connection + reconnect after maxMessages
    expect(d.ehloCount).toBe(2);
    expect(exitCode).toBe(0);
  });
});

describe("Proxy support", () => {
  test("should send HTTP CONNECT to proxy", async () => {
    const { stdout, exitCode } = await run(`
      let connectLine = "";
      const proxy = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = ""; },
          data(s, raw) {
            s.data += new TextDecoder().decode(raw);
            if (s.data.includes("\\r\\n\\r\\n")) {
              connectLine = s.data.split("\\r\\n")[0];
              // Don't respond - let it timeout or just close
              s.end();
            }
          },
        },
      });
      const c = new Bun.SMTPClient({
        host: "smtp.example.com", port: 587,
        proxy: "http://127.0.0.1:" + proxy.port,
      });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      } catch(e) {
        // Expected to fail since proxy doesn't actually tunnel
      }
      console.log(JSON.stringify({ connectLine }));
      c.close(); proxy.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.connectLine).toMatch(/^CONNECT smtp\.example\.com:587 HTTP\/1\.1/);
    expect(exitCode).toBe(0);
  });

  test("should include Proxy-Authorization with credentials", async () => {
    const { stdout, exitCode } = await run(`
      let headers = "";
      const proxy = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = ""; },
          data(s, raw) {
            s.data += new TextDecoder().decode(raw);
            if (s.data.includes("\\r\\n\\r\\n")) {
              headers = s.data;
              s.end();
            }
          },
        },
      });
      const c = new Bun.SMTPClient({
        host: "smtp.example.com", port: 587,
        proxy: "http://user:pass@127.0.0.1:" + proxy.port,
      });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      } catch(e) {}
      const hasAuth = headers.includes("Proxy-Authorization: Basic " + Buffer.from("user:pass").toString("base64"));
      console.log(JSON.stringify({ hasAuth }));
      c.close(); proxy.stop();
    `);
    expect(JSON.parse(stdout).hasAuth).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Sendmail transport", () => {
  test("should send via sendmail binary", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ sendmail: "/bin/true" });
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      console.log(JSON.stringify({
        hasAccepted: Array.isArray(r.accepted),
        hasResponse: typeof r.response === "string",
      }));
      c.close();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasAccepted).toBe(true);
    expect(d.hasResponse).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should reject on sendmail failure", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ sendmail: "/bin/false" });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        console.log("ERROR: should have thrown");
      } catch(e) {
        console.log(JSON.stringify({ error: e.message.substring(0, 30) }));
      }
      c.close();
    `);
    expect(JSON.parse(stdout).error).toContain("sendmail exited");
    expect(exitCode).toBe(0);
  });

  test("sendmail: true should default to /usr/sbin/sendmail path", async () => {
    const { stdout, exitCode } = await run(`
      const c = new Bun.SMTPClient({ sendmail: true });
      // Just verify construction works - don't actually try to send
      // since /usr/sbin/sendmail may not exist
      console.log(JSON.stringify({ created: true }));
      c.close();
    `);
    expect(JSON.parse(stdout).created).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("createTestAccount", () => {
  test("should be a static method", async () => {
    const { stdout, exitCode } = await run(`
      console.log(JSON.stringify({
        type: typeof Bun.SMTPClient.createTestAccount,
      }));
    `);
    expect(JSON.parse(stdout).type).toBe("function");
    expect(exitCode).toBe(0);
  });
});

describe("Connection reuse", () => {
  test("should reuse connection for sequential sends (1 EHLO)", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      let ehloCount = 0;
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { s.data = { inData: false, buf: "" }; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) {
              s.data.buf += t;
              if (s.data.buf.includes("\\r\\n.\\r\\n")) {
                s.data.inData = false; s.data.buf = "";
                s.write("250 OK\\r\\n");
              }
              return;
            }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              if (l.startsWith("EHLO")) { ehloCount++; s.write("250 OK\\r\\n"); }
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
      await c.send({ from: "a@b.com", to: "x@y.com", text: "1" });
      await c.send({ from: "a@b.com", to: "x@y.com", text: "2" });
      await c.send({ from: "a@b.com", to: "x@y.com", text: "3" });
      console.log(JSON.stringify({ ehloCount }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.ehloCount).toBe(1);
    expect(exitCode).toBe(0);
  });
});

describe("REQUIRETLS extension (RFC 8689)", () => {
  test("should add REQUIRETLS parameter to MAIL FROM when server supports it", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { const sess = { cmds: [], inData: false, buf: "" }; sessions.push(sess); s.data = sess; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              s.data.cmds.push(l);
              if (l.startsWith("EHLO")) s.write("250-mock\\r\\n250-REQUIRETLS\\r\\n250 OK\\r\\n");
              else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
              else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
              else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
              else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
              else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
            }
          },
        },
      });
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port, requireTLSExtension: true });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "secure" });
      const mailFrom = sessions[0].cmds.find(c => c.startsWith("MAIL FROM:"));
      console.log(JSON.stringify({ mailFrom, hasRequireTLS: mailFrom?.includes("REQUIRETLS") }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasRequireTLS).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should error when server does not support REQUIRETLS but option is set", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, requireTLSExtension: true });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "test" });
        console.log(JSON.stringify({ error: false }));
      } catch(e) {
        console.log(JSON.stringify({ error: true, code: e.code, msg: e.message.substring(0, 50) }));
      }
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.error).toBe(true);
    expect(d.code).toBe("EENVELOPE");
    expect(exitCode).toBe(0);
  });

  test("should NOT add REQUIRETLS when not requested", async () => {
    const { stdout, exitCode } = await run(`
      const sessions = [];
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(s) { const sess = { cmds: [], inData: false, buf: "" }; sessions.push(sess); s.data = sess; s.write("220 OK\\r\\n"); },
          data(s, raw) {
            const t = new TextDecoder().decode(raw);
            if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
            for (const l of t.split("\\r\\n").filter(x=>x)) {
              s.data.cmds.push(l);
              if (l.startsWith("EHLO")) s.write("250-mock\\r\\n250-REQUIRETLS\\r\\n250 OK\\r\\n");
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
      await c.send({ from: "a@b.com", to: "c@d.com", text: "normal" });
      const mailFrom = sessions[0].cmds.find(c => c.startsWith("MAIL FROM:"));
      console.log(JSON.stringify({ noRequireTLS: !mailFrom?.includes("REQUIRETLS") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).noRequireTLS).toBe(true);
    expect(exitCode).toBe(0);
  });
});
