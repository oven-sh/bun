/**
 * Tests for code paths that had zero coverage.
 * Found by auditing every branch in the source.
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
        s.write("220 mock\\r\\n");
      },
      data(s, raw) {
        const t = new TextDecoder().decode(raw);
        const sess = s.data;
        if (sess.inData) {
          sess.buf += t;
          if (sess.buf.includes("\\r\\n.\\r\\n")) {
            sess.inData = false; msgCount++;
            sess.msg = sess.buf.slice(0, sess.buf.indexOf("\\r\\n.\\r\\n"));
            sess.buf = "";
            s.write("250 OK\\r\\n");
          }
          return;
        }
        for (const l of t.split("\\r\\n").filter(x=>x)) {
          sess.cmds.push(l);
          if (l.startsWith("EHLO") || l.startsWith("LHLO")) {
            let resp = "250-mock\\r\\n";
            if (opts.auth) resp += "250-AUTH PLAIN LOGIN\\r\\n";
            resp += "250 OK\\r\\n";
            s.write(resp);
          }
          else if (l.startsWith("AUTH PLAIN")) s.write("235 OK\\r\\n");
          else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
          else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
          else if (l === "DATA") { sess.inData = true; sess.buf = ""; s.write("354 Go\\r\\n"); }
          else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
          else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
          else s.write("235 OK\\r\\n");
        }
      },
    },
  });
  return { server, sessions, port: server.port, getMsgCount: () => msgCount };
}
`;

describe("Multiple attachments", () => {
  test("should include 3 attachments with separate boundaries", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "see attached",
        attachments: [
          { filename: "file1.txt", content: "AAA" },
          { filename: "file2.txt", content: "BBB" },
          { filename: "file3.pdf", content: "CCC" },
        ],
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasFile1: msg.includes('filename="file1.txt"'),
        hasFile2: msg.includes('filename="file2.txt"'),
        hasFile3: msg.includes('filename="file3.pdf"'),
        dispositionCount: (msg.match(/Content-Disposition: attachment/g) || []).length,
        hasMixed: msg.includes("multipart/mixed"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasFile1).toBe(true);
    expect(d.hasFile2).toBe(true);
    expect(d.hasFile3).toBe(true);
    expect(d.dispositionCount).toBe(3);
    expect(d.hasMixed).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Inline images (CID)", () => {
  test("should set Content-ID header for CID attachments", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com",
        html: '<img src="cid:logo123"/>',
        attachments: [{ filename: "logo.png", content: "PNGDATA", cid: "logo123" }],
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasCid: msg.includes("Content-ID: <logo123>") || msg.includes("Content-Id: <logo123>"),
        hasInline: msg.includes("inline") || msg.includes("Content-ID"),
        hasHtml: msg.includes("cid:logo123"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasCid).toBe(true);
    expect(d.hasHtml).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Hex-encoded text body", () => {
  test("should decode hex-encoded content in text body", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      // "Hello" = 48656c6c6f in hex
      await c.send({
        from: "a@b.com", to: "c@d.com",
        text: { content: "48656c6c6f", encoding: "hex" },
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({ hasHello: msg.includes("Hello") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasHello).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Reconnect after close", () => {
  test("should reconnect and send after close()", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port, getMsgCount } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "first" });
      c.close();
      // After close, send again - should reconnect
      const r = await c.send({ from: "a@b.com", to: "c@d.com", text: "second" });
      console.log(JSON.stringify({
        accepted: r.accepted,
        total: getMsgCount(),
        sessionCount: sessions.length,
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.accepted).toEqual(["c@d.com"]);
    expect(d.total).toBe(2);
    expect(d.sessionCount).toBe(2); // New TCP connection = new session
    expect(exitCode).toBe(0);
  });
});

describe("Concurrent sends without pool", () => {
  test("should throw when sending concurrently without pool mode", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port }); // no pool: true
      const p1 = c.send({ from: "a@b.com", to: "x@y.com", text: "first" });
      let secondThrew = false;
      try {
        c.send({ from: "a@b.com", to: "x@y.com", text: "second" });
      } catch(e) {
        secondThrew = true;
      }
      await p1; // first should succeed
      console.log(JSON.stringify({ secondThrew }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).secondThrew).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("inReplyTo and references headers", () => {
  test("should include In-Reply-To and References headers", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "reply",
        inReplyTo: "<original-id@example.com>",
        references: "<ref1@example.com> <ref2@example.com>",
      });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasInReplyTo: msg.includes("In-Reply-To: <original-id@example.com>"),
        hasReferences: msg.includes("References:") && msg.includes("<ref1@example.com>"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasInReplyTo).toBe(true);
    expect(d.hasReferences).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("CC-only recipients (no to)", () => {
  test("should send to CC recipients when no 'to' in envelope", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const r = await c.send({
        from: "a@b.com", cc: "cc-only@x.com", text: "cc only",
      });
      const rcpts = sessions[0].cmds.filter(c => c.startsWith("RCPT TO:"));
      console.log(JSON.stringify({
        accepted: r.accepted,
        rcptCount: rcpts.length,
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.accepted).toEqual(["cc-only@x.com"]);
    expect(d.rcptCount).toBe(1);
    expect(exitCode).toBe(0);
  });
});

describe("URL constructor", () => {
  test("should parse smtp:// URL for connection config", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock({ auth: true });
      // Use URL format with auth
      const c = new Bun.SMTPClient("smtp://myuser:mypass@127.0.0.1:" + port);
      await c.send({ from: "a@b.com", to: "c@d.com", text: "url test" });
      const authCmd = sessions[0].cmds.find(c => c.startsWith("AUTH PLAIN"));
      // Decode the AUTH PLAIN base64 to verify credentials
      const decoded = authCmd ? Buffer.from(authCmd.slice(11), "base64").toString() : "";
      console.log(JSON.stringify({
        hasAuth: !!authCmd,
        hasUser: decoded.includes("myuser"),
        hasPass: decoded.includes("mypass"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasAuth).toBe(true);
    expect(d.hasUser).toBe(true);
    expect(d.hasPass).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("HTML-only email (no text)", () => {
  test("should send HTML without text part", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", html: "<h1>HTML Only</h1>" });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasHtml: msg.includes("<h1>HTML Only</h1>"),
        hasContentType: msg.includes("text/html"),
        noTextPlain: !msg.includes("text/plain"),
        noMultipart: !msg.includes("multipart"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasHtml).toBe(true);
    expect(d.hasContentType).toBe(true);
    // HTML-only should not create multipart/alternative
    expect(d.noMultipart).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Priority headers", () => {
  test("should add priority headers for high priority", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "urgent", priority: "high" });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasXPriority: msg.includes("X-Priority: 1"),
        hasImportance: msg.includes("Importance: High") || msg.includes("Importance: high"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasXPriority).toBe(true);
    expect(d.hasImportance).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should add priority headers for low priority", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "not urgent", priority: "low" });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({
        hasXPriority: msg.includes("X-Priority: 5"),
        hasImportance: msg.includes("Importance: Low") || msg.includes("Importance: low"),
      }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.hasXPriority).toBe(true);
    expect(d.hasImportance).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("replyTo header", () => {
  test("should include Reply-To header", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await c.send({ from: "a@b.com", to: "c@d.com", text: "hi", replyTo: "reply@example.com" });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({ hasReplyTo: msg.includes("Reply-To: reply@example.com") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasReplyTo).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("keepBcc option", () => {
  test("should keep BCC header in message when keepBcc is true", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const { server, sessions, port } = mock();
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port, keepBcc: true });
      await c.send({ from: "a@b.com", to: "c@d.com", bcc: "secret@x.com", text: "hi" });
      const msg = sessions[0].msg;
      console.log(JSON.stringify({ hasBcc: msg.includes("Bcc:") }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasBcc).toBe(true);
    expect(exitCode).toBe(0);
  });
});
