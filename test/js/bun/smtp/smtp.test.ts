import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Helper: spawn a bun process that runs inline code
async function runSmtp(code: string, timeout = 10000) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Helper: code for a reusable mock SMTP server that captures the full message
const MOCK_SERVER = `
function createMockSMTP(opts = {}) {
  const sessions = [];
  let currentSession = null;
  const { auth, rejectRecipient, rejectSender } = opts;

  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        currentSession = { commands: [], message: "", inData: false, buf: "", authenticated: false };
        sessions.push(currentSession);
        socket.data = currentSession;
        socket.write("220 localhost ESMTP MockSMTP\\r\\n");
      },
      data(socket, raw) {
        const text = new TextDecoder().decode(raw);
        const sess = socket.data;

        if (sess.inData) {
          sess.buf += text;
          if (sess.buf.includes("\\r\\n.\\r\\n")) {
            sess.inData = false;
            sess.message = sess.buf.split("\\r\\n.\\r\\n")[0];
            sess.buf = "";
            socket.write("250 OK: message queued\\r\\n");
          }
          return;
        }

        for (const line of text.split("\\r\\n").filter(l => l.length > 0)) {
          sess.commands.push(line);
          if (line.startsWith("EHLO") || line.startsWith("HELO")) {
            let response = "250-localhost\\r\\n";
            if (auth) response += "250-AUTH PLAIN LOGIN\\r\\n";
            response += "250-8BITMIME\\r\\n250-PIPELINING\\r\\n250 SIZE 10485760\\r\\n";
            socket.write(response);
          } else if (line.startsWith("AUTH PLAIN ")) {
            const cred = Buffer.from(line.slice(11), "base64").toString();
            const parts = cred.split("\\0");
            if (auth && parts[1] === auth.user && parts[2] === auth.pass) {
              sess.authenticated = true;
              socket.write("235 Authentication successful\\r\\n");
            } else {
              socket.write("535 Authentication failed\\r\\n");
            }
          } else if (line === "AUTH LOGIN") {
            socket.write("334 VXNlcm5hbWU6\\r\\n");
          } else if (line.startsWith("MAIL FROM:")) {
            if (rejectSender) {
              socket.write("550 Sender rejected\\r\\n");
            } else {
              socket.write("250 OK\\r\\n");
            }
          } else if (line.startsWith("RCPT TO:")) {
            const addr = line.match(/<(.+?)>/)?.[1];
            if (rejectRecipient && rejectRecipient === addr) {
              socket.write("550 Recipient rejected\\r\\n");
            } else {
              socket.write("250 OK\\r\\n");
            }
          } else if (line === "DATA") {
            sess.inData = true;
            sess.buf = "";
            socket.write("354 Start mail input\\r\\n");
          } else if (line === "QUIT") {
            socket.write("221 Bye\\r\\n");
            socket.end();
          } else {
            // Unknown command - echo base64 for AUTH LOGIN flow
            socket.write("334 UGFzc3dvcmQ6\\r\\n");
          }
        }
      },
    },
  });
  return { server, sessions, port: server.port };
}
`;

describe("SMTPClient", () => {
  describe("Constructor", () => {
    test("creates client with default options", async () => {
      const { stdout, exitCode } = await runSmtp(`
        const client = new Bun.SMTPClient({ host: "localhost" });
        console.log(JSON.stringify({ connected: client.connected, secure: client.secure }));
        client.close();
      `);
      expect(JSON.parse(stdout.trim())).toEqual({ connected: false, secure: false });
      expect(exitCode).toBe(0);
    });

    test("port 465 defaults to secure", async () => {
      const { stdout, exitCode } = await runSmtp(`
        const client = new Bun.SMTPClient({ host: "localhost", port: 465 });
        console.log("secure:", client.secure);
        client.close();
      `);
      expect(stdout).toContain("secure: true");
      expect(exitCode).toBe(0);
    });

    test("throws on missing options", async () => {
      const { stdout, exitCode } = await runSmtp(`
        try { new Bun.SMTPClient(); } catch(e) { console.log("error:", e.name); }
      `);
      expect(stdout).toContain("error:");
      expect(exitCode).toBe(0);
    });

    test("throws on invalid port", async () => {
      const { stdout, exitCode } = await runSmtp(`
        try { new Bun.SMTPClient({ host: "localhost", port: 99999 }); } catch(e) { console.log("error:", e.message); }
      `);
      expect(stdout).toContain("Port");
      expect(exitCode).toBe(0);
    });
  });

  describe("send() validation", () => {
    test("rejects without 'from' field", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        try {
          await client.send({ to: "a@b.com", subject: "Test", text: "hi" });
        } catch(e) { console.log("error:", e.message); }
        client.close(); server.stop();
      `);
      expect(stdout).toContain("from");
      expect(exitCode).toBe(0);
    });

    test("rejects without 'to' field", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        try {
          await client.send({ from: "a@b.com", subject: "Test", text: "hi" });
        } catch(e) { console.log("error:", e.message); }
        client.close(); server.stop();
      `);
      expect(stdout).toContain("recipient");
      expect(exitCode).toBe(0);
    });

    test("rejects on connection failure", async () => {
      const { stdout, exitCode } = await runSmtp(`
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port: 62542 });
        try {
          await client.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
        } catch(e) { console.log("rejected:", e.message.substring(0, 60)); }
        client.close();
      `);
      expect(stdout).toContain("rejected:");
      expect(exitCode).toBe(0);
    });
  });

  describe("SMTP Protocol - Basic Send (ported from nodemailer smtp-transport-test)", () => {
    test("should send plain text email", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const result = await client.send({
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "Test Subject",
          text: "Hello, World!",
        });
        const sess = sessions[0];
        console.log(JSON.stringify({
          accepted: result.accepted,
          rejected: result.rejected,
          hasResponse: result.response.length > 0,
          hasMailFrom: sess.commands.some(c => c.includes("MAIL FROM:<sender@example.com>")),
          hasRcptTo: sess.commands.some(c => c.includes("RCPT TO:<recipient@example.com>")),
          hasSubject: sess.message.includes("Subject: Test Subject"),
          hasBody: sess.message.includes("Hello, World!"),
          hasMime: sess.message.includes("MIME-Version: 1.0"),
          hasContentType: sess.message.includes("text/plain"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data).toEqual({
        accepted: ["recipient@example.com"],
        rejected: [],
        hasResponse: true,
        hasMailFrom: true,
        hasRcptTo: true,
        hasSubject: true,
        hasBody: true,
        hasMime: true,
        hasContentType: true,
      });
      expect(exitCode).toBe(0);
    });

    test("should send HTML email", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "HTML Test",
          html: "<h1>Hello</h1><p>World</p>",
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasHtmlType: msg.includes("text/html"),
          hasH1: msg.includes("<h1>Hello</h1>"),
        }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim())).toEqual({ hasHtmlType: true, hasH1: true });
      expect(exitCode).toBe(0);
    });

    test("should send multipart/alternative with text and HTML", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "Multipart Test",
          text: "Plain text version",
          html: "<b>HTML version</b>",
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasAlternative: msg.includes("multipart/alternative"),
          hasPlain: msg.includes("text/plain"),
          hasHtml: msg.includes("text/html"),
          hasTextContent: msg.includes("Plain text version"),
          hasHtmlContent: msg.includes("HTML version"),
        }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim())).toEqual({
        hasAlternative: true,
        hasPlain: true,
        hasHtml: true,
        hasTextContent: true,
        hasHtmlContent: true,
      });
      expect(exitCode).toBe(0);
    });

    test("should send to multiple recipients", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const result = await client.send({
          from: "sender@example.com",
          to: ["alice@example.com", "bob@example.com", "charlie@example.com"],
          text: "Hello all",
        });
        const cmds = sessions[0].commands;
        console.log(JSON.stringify({
          accepted: result.accepted,
          rcptCount: cmds.filter(c => c.startsWith("RCPT TO:")).length,
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.accepted).toHaveLength(3);
      expect(data.rcptCount).toBe(3);
      expect(exitCode).toBe(0);
    });

    test("should include CC and BCC in envelope", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const result = await client.send({
          from: "sender@example.com",
          to: "alice@example.com",
          cc: "bob@example.com",
          bcc: "secret@example.com",
          text: "Hello",
        });
        const cmds = sessions[0].commands;
        const rcpts = cmds.filter(c => c.startsWith("RCPT TO:"));
        console.log(JSON.stringify({
          accepted: result.accepted,
          rcptCount: rcpts.length,
          hasAlice: rcpts.some(r => r.includes("alice@example.com")),
          hasBob: rcpts.some(r => r.includes("bob@example.com")),
          hasSecret: rcpts.some(r => r.includes("secret@example.com")),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.accepted).toHaveLength(3);
      expect(data.accepted).toContain("alice@example.com");
      expect(data.accepted).toContain("bob@example.com");
      expect(data.accepted).toContain("secret@example.com");
      expect(data.rcptCount).toBe(3);
      expect(data.hasAlice).toBe(true);
      expect(data.hasBob).toBe(true);
      expect(data.hasSecret).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Address Parsing (ported from nodemailer addressparser-test)", () => {
    test("should extract email from 'Name <email>' format", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: '"John Doe" <john@example.com>',
          to: '"Alice Smith" <alice@example.com>',
          text: "test",
        });
        const cmds = sessions[0].commands;
        console.log(JSON.stringify({
          mailFrom: cmds.find(c => c.startsWith("MAIL FROM:")),
          rcptTo: cmds.find(c => c.startsWith("RCPT TO:")),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.mailFrom).toContain("MAIL FROM:<john@example.com>");
      expect(data.rcptTo).toBe("RCPT TO:<alice@example.com>");
      expect(exitCode).toBe(0);
    });

    test("should handle bare email addresses", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({ from: "sender@test.com", to: "recipient@test.com", text: "test" });
        const cmds = sessions[0].commands;
        console.log(JSON.stringify({
          mailFrom: cmds.find(c => c.startsWith("MAIL FROM:")),
          rcptTo: cmds.find(c => c.startsWith("RCPT TO:")),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.mailFrom).toContain("MAIL FROM:<sender@test.com>");
      expect(data.rcptTo).toBe("RCPT TO:<recipient@test.com>");
      expect(exitCode).toBe(0);
    });

    test("should preserve display names in headers", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: '"John Doe" <john@example.com>',
          to: '"Alice" <alice@example.com>',
          text: "test",
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          fromHeader: msg.includes('From: "John Doe" <john@example.com>'),
          toHeader: msg.includes('To: "Alice" <alice@example.com>'),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.fromHeader).toBe(true);
      expect(data.toHeader).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("MIME Encoding (ported from nodemailer mime-funcs-test & qp-test)", () => {
    test("should encode non-ASCII subject with RFC 2047", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          subject: "Tere õhtust! 🎉",
          text: "body",
        });
        const msg = sessions[0].message;
        const subjectLine = msg.split("\\r\\n").find(l => l.startsWith("Subject:"));
        console.log(JSON.stringify({
          hasEncodedWord: subjectLine.includes("=?UTF-8?B?"),
          // Decode and verify roundtrip
          decoded: Buffer.from(subjectLine.match(/=\\?UTF-8\\?B\\?(.+?)\\?=/)?.[1] || "", "base64").toString(),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasEncodedWord).toBe(true);
      expect(data.decoded).toBe("Tere õhtust! 🎉");
      expect(exitCode).toBe(0);
    });

    test("should NOT encode ASCII-only subject", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          subject: "Plain ASCII subject",
          text: "body",
        });
        const msg = sessions[0].message;
        const subjectLine = msg.split("\\r\\n").find(l => l.startsWith("Subject:"));
        console.log(JSON.stringify({
          subject: subjectLine,
          noEncoding: !subjectLine.includes("=?"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.subject).toBe("Subject: Plain ASCII subject");
      expect(data.noEncoding).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should use quoted-printable for body content", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          subject: "QP Test",
          text: "Special chars: ÕÄÖÜ = equals sign",
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasQP: msg.includes("quoted-printable"),
          hasEncodedEquals: msg.includes("=3D"),
          hasEncodedO: msg.includes("=C3=95"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasQP).toBe(true);
      expect(data.hasEncodedEquals).toBe(true);
      expect(data.hasEncodedO).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Attachments (ported from nodemailer mail-composer-test)", () => {
    test("should create multipart/mixed with string attachment", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: "See attached",
          attachments: [{ filename: "test.txt", content: "Hello from file!" }],
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasMixed: msg.includes("multipart/mixed"),
          hasAttachment: msg.includes("attachment"),
          hasFilename: msg.includes('filename="test.txt"'),
          hasBase64: msg.includes("Content-Transfer-Encoding: base64"),
          hasEncodedContent: msg.includes(Buffer.from("Hello from file!").toString("base64")),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasMixed).toBe(true);
      expect(data.hasAttachment).toBe(true);
      expect(data.hasFilename).toBe(true);
      expect(data.hasBase64).toBe(true);
      expect(data.hasEncodedContent).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should create multipart/mixed with Buffer attachment", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: "Binary file attached",
          attachments: [{ filename: "data.bin", content: binaryData }],
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasBase64: msg.includes("Content-Transfer-Encoding: base64"),
          hasEncodedContent: msg.includes(binaryData.toString("base64")),
          hasMimeType: msg.includes("application/octet-stream"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasBase64).toBe(true);
      expect(data.hasEncodedContent).toBe(true);
      expect(data.hasMimeType).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should detect MIME type from filename extension", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: "Files attached",
          attachments: [
            { filename: "image.png", content: "fake-png" },
            { filename: "doc.pdf", content: "fake-pdf" },
            { filename: "style.css", content: "body{}" },
          ],
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasPng: msg.includes("image/png"),
          hasPdf: msg.includes("application/pdf"),
          hasCss: msg.includes("text/css"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasPng).toBe(true);
      expect(data.hasPdf).toBe(true);
      expect(data.hasCss).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should use custom contentType when provided", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: "Custom type",
          attachments: [{ filename: "data.xyz", content: "custom", contentType: "application/x-custom" }],
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({ hasCustomType: msg.includes("application/x-custom") }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim()).hasCustomType).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should handle text+html+attachments (multipart/mixed with nested alternative)", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: "Plain",
          html: "<b>Bold</b>",
          attachments: [{ filename: "f.txt", content: "attached" }],
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasMixed: msg.includes("multipart/mixed"),
          hasAlternative: msg.includes("multipart/alternative"),
          hasPlain: msg.includes("text/plain"),
          hasHtml: msg.includes("text/html"),
          hasAttachment: msg.includes('filename="f.txt"'),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data).toEqual({
        hasMixed: true,
        hasAlternative: true,
        hasPlain: true,
        hasHtml: true,
        hasAttachment: true,
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("Custom Headers", () => {
    test("should include custom headers in message", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          subject: "Test",
          text: "body",
          headers: { "X-Custom-Header": "custom-value", "X-Priority": "1" },
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasCustom: msg.includes("X-Custom-Header: custom-value"),
          hasPriority: msg.includes("X-Priority: 1"),
          hasXMailer: msg.includes("X-Mailer: Bun"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasCustom).toBe(true);
      expect(data.hasPriority).toBe(true);
      expect(data.hasXMailer).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Message Headers", () => {
    test("should include Message-ID header", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({ from: "a@b.com", to: "c@d.com", text: "body" });
        const msg = sessions[0].message;
        const mid = msg.split("\\r\\n").find(l => l.startsWith("Message-ID:"));
        console.log(JSON.stringify({
          hasMessageId: !!mid,
          format: /Message-ID: <[a-f0-9]+@bun>/.test(mid),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasMessageId).toBe(true);
      expect(data.format).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should include Date header", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({ from: "a@b.com", to: "c@d.com", text: "body" });
        const msg = sessions[0].message;
        console.log(JSON.stringify({ hasDate: msg.includes("Date:") }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim()).hasDate).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should include Reply-To header", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({ from: "a@b.com", to: "c@d.com", replyTo: "reply@test.com", text: "body" });
        const msg = sessions[0].message;
        console.log(JSON.stringify({ hasReplyTo: msg.includes("Reply-To: reply@test.com") }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim()).hasReplyTo).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should display array recipients in To header", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com",
          to: ["alice@test.com", "bob@test.com"],
          text: "body",
        });
        const msg = sessions[0].message;
        const toLine = msg.split("\\r\\n").find(l => l.startsWith("To:"));
        console.log(JSON.stringify({
          toHeader: toLine,
          hasBoth: toLine.includes("alice@test.com") && toLine.includes("bob@test.com"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasBoth).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Authentication (ported from nodemailer smtp-connection-test)", () => {
    test("should authenticate with AUTH PLAIN", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP({ auth: { user: "testuser", pass: "testpass" } });
        const client = new Bun.SMTPClient({
          host: "127.0.0.1", port,
          auth: { user: "testuser", pass: "testpass" },
        });
        const result = await client.send({
          from: "a@b.com", to: "c@d.com", text: "authenticated email",
        });
        console.log(JSON.stringify({
          accepted: result.accepted,
          authenticated: sessions[0].authenticated,
          hasAuthCmd: sessions[0].commands.some(c => c.startsWith("AUTH PLAIN")),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.accepted).toEqual(["c@d.com"]);
      expect(data.authenticated).toBe(true);
      expect(data.hasAuthCmd).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should fail with wrong credentials", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, port } = createMockSMTP({ auth: { user: "testuser", pass: "testpass" } });
        const client = new Bun.SMTPClient({
          host: "127.0.0.1", port,
          auth: { user: "testuser", pass: "wrongpass" },
        });
        try {
          await client.send({ from: "a@b.com", to: "c@d.com", text: "should fail" });
          console.log("ERROR: should have thrown");
        } catch(e) {
          console.log("rejected:", e.message);
        }
        client.close(); server.stop();
      `);
      expect(stdout).toContain("rejected:");
      expect(stdout).toContain("Authentication failed");
      expect(exitCode).toBe(0);
    });

    test("should skip auth if no credentials", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const result = await client.send({ from: "a@b.com", to: "c@d.com", text: "no auth" });
        console.log(JSON.stringify({
          accepted: result.accepted,
          noAuth: !sessions[0].commands.some(c => c.startsWith("AUTH")),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.accepted).toEqual(["c@d.com"]);
      expect(data.noAuth).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Error Handling (ported from nodemailer smtp-connection-test)", () => {
    test("should handle rejected sender", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, port } = createMockSMTP({ rejectSender: true });
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        try {
          await client.send({ from: "bad@sender.com", to: "c@d.com", text: "test" });
          console.log("ERROR: should have thrown");
        } catch(e) {
          console.log("rejected:", e.message);
        }
        client.close(); server.stop();
      `);
      expect(stdout).toContain("rejected:");
      expect(stdout).toContain("MAIL FROM rejected");
      expect(exitCode).toBe(0);
    });

    test("should handle partial recipient rejection", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, port } = createMockSMTP({ rejectRecipient: "bad@example.com" });
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const result = await client.send({
          from: "a@b.com",
          to: ["good@example.com", "bad@example.com"],
          text: "partial reject",
        });
        console.log(JSON.stringify({ accepted: result.accepted, rejected: result.rejected }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.accepted).toEqual(["good@example.com"]);
      expect(data.rejected).toEqual(["bad@example.com"]);
      expect(exitCode).toBe(0);
    });

    test("should reject when ALL recipients rejected", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, port } = createMockSMTP({ rejectRecipient: "only@recipient.com" });
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        try {
          await client.send({ from: "a@b.com", to: "only@recipient.com", text: "test" });
          console.log("ERROR: should have thrown");
        } catch(e) {
          console.log("rejected:", e.message);
        }
        client.close(); server.stop();
      `);
      expect(stdout).toContain("rejected");
      expect(exitCode).toBe(0);
    });
  });

  describe("verify() method", () => {
    test("returns a promise", async () => {
      const { stdout, exitCode } = await runSmtp(`
        const client = new Bun.SMTPClient({ host: "localhost" });
        const result = client.verify();
        console.log("is_promise:", result instanceof Promise);
        try { await result; } catch(e) {}
        client.close();
      `);
      expect(stdout).toContain("is_promise: true");
      expect(exitCode).toBe(0);
    });
  });

  describe("Well-Known Services (ported from nodemailer well-known-test)", () => {
    test("should resolve 'gmail' to smtp.gmail.com:465 secure", async () => {
      const { stdout, exitCode } = await runSmtp(`
        const client = new Bun.SMTPClient({ service: "gmail", auth: { user: "x", pass: "y" } });
        console.log(JSON.stringify({ secure: client.secure }));
        client.close();
      `);
      expect(JSON.parse(stdout.trim()).secure).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should resolve 'outlook365'", async () => {
      const { stdout, exitCode } = await runSmtp(`
        const client = new Bun.SMTPClient({ service: "outlook365" });
        console.log(JSON.stringify({ secure: client.secure }));
        client.close();
      `);
      // Outlook365 is port 587, not secure (uses STARTTLS)
      expect(JSON.parse(stdout.trim()).secure).toBe(false);
      expect(exitCode).toBe(0);
    });
  });

  describe("Raw Message Support", () => {
    test("should send raw RFC822 message as-is", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const rawMsg = "From: raw@test.com\\r\\nTo: dest@test.com\\r\\nSubject: Raw\\r\\n\\r\\nRaw body";
        await client.send({
          from: "raw@test.com",
          to: "dest@test.com",
          raw: rawMsg,
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          isRaw: msg.includes("Raw body"),
          hasRawSubject: msg.includes("Subject: Raw"),
          noXMailer: !msg.includes("X-Mailer"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.isRaw).toBe(true);
      expect(data.hasRawSubject).toBe(true);
      expect(data.noXMailer).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Inline Images (CID)", () => {
    test("should set Content-Id for inline attachments", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          html: '<img src="cid:logo"/>',
          attachments: [
            { filename: "logo.png", content: "fake-png-data", cid: "logo" },
          ],
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasCid: msg.includes("Content-Id: <logo>"),
          isInline: msg.includes("Content-Disposition: inline"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasCid).toBe(true);
      expect(data.isInline).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("File Path Attachments", () => {
    test("should read file from filesystem path", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        // Create a temp file
        const tmpFile = "/tmp/bun-smtp-test-" + Date.now() + ".txt";
        require("fs").writeFileSync(tmpFile, "file content from disk");

        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: "See attached file",
          attachments: [{ filename: "disk-file.txt", path: tmpFile }],
        });
        const msg = sessions[0].message;
        // The file content should be base64-encoded in the message
        const encoded = Buffer.from("file content from disk").toString("base64");
        console.log(JSON.stringify({
          hasFilename: msg.includes('filename="disk-file.txt"'),
          hasContent: msg.includes(encoded),
        }));
        require("fs").unlinkSync(tmpFile);
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasFilename).toBe(true);
      expect(data.hasContent).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Data URI Attachments", () => {
    test("should decode data: URI attachments", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        const b64data = Buffer.from("hello data uri").toString("base64");
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: "data uri test",
          attachments: [{ filename: "data.txt", path: "data:text/plain;base64," + b64data }],
        });
        const msg = sessions[0].message;
        console.log(JSON.stringify({
          hasFilename: msg.includes('filename="data.txt"'),
          hasContent: msg.includes(b64data),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasFilename).toBe(true);
      expect(data.hasContent).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Message-ID Hostname", () => {
    test("should use custom hostname in Message-ID", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port, hostname: "example.com" });
        await client.send({ from: "a@b.com", to: "c@d.com", text: "body" });
        const msg = sessions[0].message;
        const mid = msg.split("\\r\\n").find(l => l.startsWith("Message-ID:"));
        console.log(JSON.stringify({
          hasCustomHostname: mid.includes("@example.com>"),
        }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim()).hasCustomHostname).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("SIZE Extension", () => {
    test("should include SIZE in MAIL FROM when server supports it", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({ from: "a@b.com", to: "c@d.com", text: "body" });
        const mailFrom = sessions[0].commands.find(c => c.startsWith("MAIL FROM:"));
        console.log(JSON.stringify({
          hasSize: /SIZE=\\d+/.test(mailFrom),
        }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim()).hasSize).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("TLS Options", () => {
    test("should respect ignoreTLS option", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        // Mock server that advertises STARTTLS
        function createSTARTTLSServer() {
          const sessions = [];
          const server = Bun.listen({
            hostname: "127.0.0.1", port: 0,
            socket: {
              open(socket) {
                const sess = { commands: [], message: "", inData: false, buf: "" };
                sessions.push(sess);
                socket.data = sess;
                socket.write("220 localhost ESMTP\\r\\n");
              },
              data(socket, raw) {
                const text = new TextDecoder().decode(raw);
                const sess = socket.data;
                if (sess.inData) {
                  sess.buf += text;
                  if (sess.buf.includes("\\r\\n.\\r\\n")) {
                    sess.inData = false;
                    sess.message = sess.buf.split("\\r\\n.\\r\\n")[0];
                    sess.buf = "";
                    socket.write("250 OK\\r\\n");
                  }
                  return;
                }
                for (const line of text.split("\\r\\n").filter(l => l)) {
                  sess.commands.push(line);
                  if (line.startsWith("EHLO")) {
                    socket.write("250-localhost\\r\\n250-STARTTLS\\r\\n250 OK\\r\\n");
                  } else if (line.startsWith("MAIL FROM:")) socket.write("250 OK\\r\\n");
                  else if (line.startsWith("RCPT TO:")) socket.write("250 OK\\r\\n");
                  else if (line === "DATA") { sess.inData = true; sess.buf = ""; socket.write("354 Go\\r\\n"); }
                  else if (line === "QUIT") { socket.write("221 Bye\\r\\n"); socket.end(); }
                }
              },
            },
          });
          return { server, sessions, port: server.port };
        }

        const { server, sessions, port } = createSTARTTLSServer();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port, ignoreTLS: true });
        const result = await client.send({ from: "a@b.com", to: "c@d.com", text: "no tls" });
        console.log(JSON.stringify({
          accepted: result.accepted,
          noSTARTTLS: !sessions[0].commands.some(c => c === "STARTTLS"),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.accepted).toEqual(["c@d.com"]);
      expect(data.noSTARTTLS).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("Connection Reuse (ported from nodemailer smtp-pool-test)", () => {
    test("should send multiple messages over single connection", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        function createRsetServer() {
          let msgCount = 0;
          let ehloCount = 0;
          const server = Bun.listen({
            hostname: "127.0.0.1", port: 0,
            socket: {
              open(socket) { socket.data = { inData: false, buf: "" }; socket.write("220 OK\\r\\n"); },
              data(socket, raw) {
                const text = new TextDecoder().decode(raw);
                if (socket.data.inData) {
                  socket.data.buf += text;
                  if (socket.data.buf.includes("\\r\\n.\\r\\n")) {
                    socket.data.inData = false;
                    msgCount++;
                    socket.data.buf = "";
                    socket.write("250 OK msg #" + msgCount + "\\r\\n");
                  }
                  return;
                }
                for (const line of text.split("\\r\\n").filter(l => l)) {
                  if (line.startsWith("EHLO")) { ehloCount++; socket.write("250 OK\\r\\n"); }
                  else if (line.startsWith("MAIL")) socket.write("250 OK\\r\\n");
                  else if (line.startsWith("RCPT")) socket.write("250 OK\\r\\n");
                  else if (line === "DATA") { socket.data.inData = true; socket.data.buf = ""; socket.write("354 Go\\r\\n"); }
                  else if (line.startsWith("RSET")) socket.write("250 OK\\r\\n");
                  else if (line === "QUIT") { socket.write("221 Bye\\r\\n"); socket.end(); }
                }
              },
            },
          });
          return { server, port: server.port, getMsgCount: () => msgCount, getEhloCount: () => ehloCount };
        }

        const { server, port, getMsgCount, getEhloCount } = createRsetServer();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });

        await client.send({ from: "a@b.com", to: "c@d.com", text: "msg 1" });
        await client.send({ from: "a@b.com", to: "c@d.com", text: "msg 2" });
        await client.send({ from: "a@b.com", to: "c@d.com", text: "msg 3" });

        console.log(JSON.stringify({
          msgCount: getMsgCount(),
          ehloCount: getEhloCount(),
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.msgCount).toBe(3);
      // Only 1 EHLO should have been sent (connection reuse, no reconnect)
      expect(data.ehloCount).toBe(1);
      expect(exitCode).toBe(0);
    });
  });

  describe("DKIM Signing (ported from nodemailer dkim-test)", () => {
    test("should add DKIM-Signature header when dkim config provided", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        // Generate a test RSA key
        const { privateKey } = await crypto.subtle.generateKey(
          { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
          true, ["sign", "verify"]
        );
        const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
        const pem = "-----BEGIN PRIVATE KEY-----\\n" +
          Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g).join("\\n") +
          "\\n-----END PRIVATE KEY-----";

        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "dkim@example.com", to: "dest@test.com",
          subject: "DKIM Test",
          text: "Testing DKIM",
          dkim: { domainName: "example.com", keySelector: "s1", privateKey: pem },
        });
        const msg = sessions[0].message;
        const dkimLine = msg.split("\\r\\n").find(l => l.startsWith("DKIM-Signature:")) || "";
        console.log(JSON.stringify({
          hasDkim: msg.includes("DKIM-Signature:"),
          hasVersion: dkimLine.includes("v=1"),
          hasAlgo: dkimLine.includes("a=rsa-sha256"),
          hasDomain: dkimLine.includes("d=example.com"),
          hasSelector: dkimLine.includes("s=s1"),
          hasBodyHash: dkimLine.includes("bh="),
          hasSignature: dkimLine.includes("b=") && dkimLine.split("b=").pop().length > 20,
        }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.hasDkim).toBe(true);
      expect(data.hasVersion).toBe(true);
      expect(data.hasAlgo).toBe(true);
      expect(data.hasDomain).toBe(true);
      expect(data.hasSelector).toBe(true);
      expect(data.hasBodyHash).toBe(true);
      expect(data.hasSignature).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("should send without DKIM when no dkim config", async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({ from: "a@b.com", to: "c@d.com", text: "no dkim" });
        const msg = sessions[0].message;
        console.log(JSON.stringify({ noDkim: !msg.includes("DKIM-Signature:") }));
        client.close(); server.stop();
      `);
      expect(JSON.parse(stdout.trim()).noDkim).toBe(true);
      expect(exitCode).toBe(0);
    });
  });
});
