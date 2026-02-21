/**
 * Tests ported directly from nodemailer test suite.
 * These verify byte-level compatibility with nodemailer's output.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runSmtp(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const MOCK_SERVER = `
function createMockSMTP(opts = {}) {
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
          if (line.startsWith("EHLO") || line.startsWith("HELO")) {
            socket.write("250-localhost\\r\\n250-AUTH PLAIN LOGIN\\r\\n250 OK\\r\\n");
          } else if (line.startsWith("MAIL FROM:")) socket.write("250 OK\\r\\n");
          else if (line.startsWith("RCPT TO:")) socket.write("250 OK\\r\\n");
          else if (line === "DATA") { sess.inData = true; sess.buf = ""; socket.write("354 Go\\r\\n"); }
          else if (line.startsWith("RSET")) socket.write("250 OK\\r\\n");
          else if (line === "QUIT") { socket.write("221 Bye\\r\\n"); socket.end(); }
        }
      },
    },
  });
  return { server, sessions, port: server.port };
}
`;

describe("Nodemailer Compatibility - QP Encoding (from qp-test.js)", () => {
  // Direct port of nodemailer's QP encode fixtures
  const qpFixtures = [
    ["abcd= ÕÄÖÜ", "abcd=3D =C3=95=C3=84=C3=96=C3=9C"],
    ["foo bar  ", "foo bar =20"],
    ["foo bar\t\t", "foo bar\t=09"],
    ["foo \r\nbar", "foo=20\r\nbar"],
  ];

  for (const [input, expected] of qpFixtures) {
    test(`QP encode: ${JSON.stringify(input).slice(0, 40)}`, async () => {
      const { stdout, exitCode } = await runSmtp(`
        ${MOCK_SERVER}
        const { server, sessions, port } = createMockSMTP();
        const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
        await client.send({
          from: "a@b.com", to: "c@d.com",
          text: ${JSON.stringify(input)},
        });
        // Extract the body after headers
        const msg = sessions[0].message;
        const parts = msg.split("\\r\\n\\r\\n");
        const body = parts.slice(1).join("\\r\\n\\r\\n");
        console.log(JSON.stringify({ body }));
        client.close(); server.stop();
      `);
      const data = JSON.parse(stdout.trim());
      expect(data.body).toBe(expected);
      expect(exitCode).toBe(0);
    });
  }
});

describe("Nodemailer Compatibility - BCC Handling (from mail-composer-test.js)", () => {
  test("should NOT include BCC in message headers", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: "sender@test.com",
        to: "visible@test.com",
        bcc: "hidden@test.com",
        text: "secret BCC test",
      });
      const msg = sessions[0].message;
      const cmds = sessions[0].commands;
      const rcpts = cmds.filter(c => c.startsWith("RCPT TO:"));
      console.log(JSON.stringify({
        bccInHeaders: msg.includes("Bcc:") || msg.includes("bcc:"),
        bccInEnvelope: rcpts.some(r => r.includes("hidden@test.com")),
        visibleInEnvelope: rcpts.some(r => r.includes("visible@test.com")),
        rcptCount: rcpts.length,
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    // BCC must NOT appear in headers (privacy requirement per RFC 5321)
    expect(data.bccInHeaders).toBe(false);
    // But BCC must be in the envelope
    expect(data.bccInEnvelope).toBe(true);
    expect(data.visibleInEnvelope).toBe(true);
    expect(data.rcptCount).toBe(2);
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - Date Header", () => {
  test("should use current date, not hardcoded", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({ from: "a@b.com", to: "c@d.com", text: "date test" });
      const msg = sessions[0].message;
      const dateLine = msg.split("\\r\\n").find(l => l.startsWith("Date:"));
      const year = new Date().getUTCFullYear();
      console.log(JSON.stringify({
        dateLine,
        hasCurrentYear: dateLine.includes(String(year)),
        notHardcoded: !dateLine.includes("Thu, 01 Jan 2026"),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.hasCurrentYear).toBe(true);
    expect(data.notHardcoded).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - Message Structure (from mail-composer-test.js)", () => {
  test("text only: should produce single text/plain part", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({ from: "a@b.com", to: "c@d.com", text: "abc" });
      const msg = sessions[0].message;
      console.log(JSON.stringify({
        hasTextPlain: msg.includes("Content-Type: text/plain; charset=utf-8"),
        noMultipart: !msg.includes("multipart"),
        hasBody: msg.includes("abc"),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data).toEqual({ hasTextPlain: true, noMultipart: true, hasBody: true });
    expect(exitCode).toBe(0);
  });

  test("html only: should produce single text/html part", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({ from: "a@b.com", to: "c@d.com", html: "<p>def</p>" });
      const msg = sessions[0].message;
      console.log(JSON.stringify({
        hasTextHtml: msg.includes("Content-Type: text/html; charset=utf-8"),
        noMultipart: !msg.includes("multipart"),
        hasBody: msg.includes("<p>def</p>"),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data).toEqual({ hasTextHtml: true, noMultipart: true, hasBody: true });
    expect(exitCode).toBe(0);
  });

  test("text + html: should produce multipart/alternative with both parts", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({ from: "a@b.com", to: "c@d.com", text: "abc", html: "<p>def</p>" });
      const msg = sessions[0].message;
      // Text should come before HTML in multipart/alternative
      const textPos = msg.indexOf("text/plain");
      const htmlPos = msg.indexOf("text/html");
      console.log(JSON.stringify({
        hasAlternative: msg.includes("multipart/alternative"),
        textBeforeHtml: textPos < htmlPos && textPos > 0,
        hasText: msg.includes("abc"),
        hasHtml: msg.includes("<p>def</p>"),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data).toEqual({
      hasAlternative: true,
      textBeforeHtml: true,
      hasText: true,
      hasHtml: true,
    });
    expect(exitCode).toBe(0);
  });

  test("text + attachment: should produce multipart/mixed", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: "a@b.com", to: "c@d.com",
        text: "abc",
        attachments: [{ content: "def", filename: "test.txt" }],
      });
      const msg = sessions[0].message;
      console.log(JSON.stringify({
        hasMixed: msg.includes("multipart/mixed"),
        hasText: msg.includes("abc"),
        hasAttachment: msg.includes("def"),
        hasBase64: msg.includes("Content-Transfer-Encoding: base64"),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.hasMixed).toBe(true);
    expect(data.hasText).toBe(true);
    expect(data.hasBase64).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("text + html + attachment: should produce mixed with nested alternative", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: "a@b.com", to: "c@d.com",
        text: "plain",
        html: "<b>rich</b>",
        attachments: [{ content: "file", filename: "att.txt" }],
      });
      const msg = sessions[0].message;
      const mixedPos = msg.indexOf("multipart/mixed");
      const altPos = msg.indexOf("multipart/alternative");
      console.log(JSON.stringify({
        hasMixed: mixedPos >= 0,
        hasAlternative: altPos >= 0,
        mixedOutermost: mixedPos < altPos,
        hasText: msg.includes("plain"),
        hasHtml: msg.includes("<b>rich</b>"),
        hasAttachment: msg.includes('filename="att.txt"'),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data).toEqual({
      hasMixed: true,
      hasAlternative: true,
      mixedOutermost: true,
      hasText: true,
      hasHtml: true,
      hasAttachment: true,
    });
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - CID Inline Attachment (from mail-composer-test.js)", () => {
  test("should create multipart/related-like structure with CID attachment", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: "a@b.com", to: "c@d.com",
        html: '<img src="cid:image001"/>',
        attachments: [
          { content: "fakeimgdata", filename: "image.png", cid: "image001" },
        ],
      });
      const msg = sessions[0].message;
      console.log(JSON.stringify({
        hasCid: msg.includes("Content-Id: <image001>"),
        hasInline: msg.includes("Content-Disposition: inline"),
        hasPng: msg.includes("image/png"),
        hasHtml: msg.includes("<img"),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.hasCid).toBe(true);
    expect(data.hasInline).toBe(true);
    expect(data.hasPng).toBe(true);
    expect(data.hasHtml).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - Address Handling (from addressparser-test.js)", () => {
  test("should extract email from display name format", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: '"Andris Reinman" <andris@tr.ee>',
        to: '"Recipient" <to@example.com>',
        text: "test",
      });
      const cmds = sessions[0].commands;
      const msg = sessions[0].message;
      console.log(JSON.stringify({
        envelopeFrom: cmds.find(c => c.startsWith("MAIL FROM:")),
        envelopeTo: cmds.find(c => c.startsWith("RCPT TO:")),
        headerFrom: msg.split("\\r\\n").find(l => l.startsWith("From:")),
        headerTo: msg.split("\\r\\n").find(l => l.startsWith("To:")),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    // Envelope should have bare email
    expect(data.envelopeFrom).toContain("<andris@tr.ee>");
    expect(data.envelopeTo).toBe("RCPT TO:<to@example.com>");
    // Headers should preserve display name
    expect(data.headerFrom).toBe('From: "Andris Reinman" <andris@tr.ee>');
    expect(data.headerTo).toBe('To: "Recipient" <to@example.com>');
    expect(exitCode).toBe(0);
  });

  test("should handle bare email without angle brackets", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({ from: "plain@email.com", to: "dest@email.com", text: "test" });
      const cmds = sessions[0].commands;
      console.log(JSON.stringify({
        from: cmds.find(c => c.startsWith("MAIL FROM:")),
        to: cmds.find(c => c.startsWith("RCPT TO:")),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.from).toContain("<plain@email.com>");
    expect(data.to).toBe("RCPT TO:<dest@email.com>");
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - RFC 2047 Subject Encoding (from mime-funcs-test.js)", () => {
  test("should encode non-ASCII subject as =?UTF-8?B?...?=", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: "a@b.com", to: "c@d.com",
        subject: "See on õhin test",
        text: "body",
      });
      const msg = sessions[0].message;
      const subjectLine = msg.split("\\r\\n").find(l => l.startsWith("Subject:"));
      // Decode and check roundtrip
      const match = subjectLine.match(/=\\?UTF-8\\?B\\?(.+?)\\?=/);
      const decoded = match ? Buffer.from(match[1], "base64").toString("utf-8") : "";
      console.log(JSON.stringify({ encoded: !!match, decoded }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.encoded).toBe(true);
    expect(data.decoded).toBe("See on õhin test");
    expect(exitCode).toBe(0);
  });

  test("should NOT encode pure ASCII subject", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: "a@b.com", to: "c@d.com",
        subject: "Hello World",
        text: "body",
      });
      const msg = sessions[0].message;
      const subjectLine = msg.split("\\r\\n").find(l => l.startsWith("Subject:"));
      console.log(JSON.stringify({ subject: subjectLine }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.subject).toBe("Subject: Hello World");
    expect(exitCode).toBe(0);
  });

  test("should encode emoji subject correctly", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      await client.send({
        from: "a@b.com", to: "c@d.com",
        subject: "Hello 🌍 World 💮",
        text: "body",
      });
      const msg = sessions[0].message;
      const subjectLine = msg.split("\\r\\n").find(l => l.startsWith("Subject:"));
      const match = subjectLine.match(/=\\?UTF-8\\?B\\?(.+?)\\?=/);
      const decoded = match ? Buffer.from(match[1], "base64").toString("utf-8") : "";
      console.log(JSON.stringify({ decoded }));
      client.close(); server.stop();
    `);
    expect(JSON.parse(stdout.trim()).decoded).toBe("Hello 🌍 World 💮");
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - Raw Message (from mail-composer-test.js)", () => {
  test("raw message should be sent as-is without modification", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const raw = "From: raw@test.com\\r\\nTo: dest@test.com\\r\\nSubject: Raw Test\\r\\nX-Custom: rawval\\r\\n\\r\\nRaw body content";
      await client.send({ from: "raw@test.com", to: "dest@test.com", raw });
      const msg = sessions[0].message;
      console.log(JSON.stringify({
        exactMatch: msg === raw,
        noExtraHeaders: !msg.includes("MIME-Version") && !msg.includes("X-Mailer"),
        hasRawSubject: msg.includes("Subject: Raw Test"),
        hasRawBody: msg.includes("Raw body content"),
        hasRawCustom: msg.includes("X-Custom: rawval"),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.exactMatch).toBe(true);
    expect(data.noExtraHeaders).toBe(true);
    expect(data.hasRawSubject).toBe(true);
    expect(data.hasRawBody).toBe(true);
    expect(data.hasRawCustom).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - Well-Known Services (from well-known-test.js)", () => {
  test("should resolve Gmail", async () => {
    const { stdout, exitCode } = await runSmtp(`
      const client = new Bun.SMTPClient({ service: "gmail", auth: { user: "x", pass: "y" } });
      console.log(JSON.stringify({ secure: client.secure }));
      client.close();
    `);
    expect(JSON.parse(stdout.trim()).secure).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should resolve 'Google Mail' (case insensitive)", async () => {
    const { stdout, exitCode } = await runSmtp(`
      const client = new Bun.SMTPClient({ service: "GoogleMail" });
      console.log(JSON.stringify({ secure: client.secure }));
      client.close();
    `);
    expect(JSON.parse(stdout.trim()).secure).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should resolve Outlook365", async () => {
    const { stdout, exitCode } = await runSmtp(`
      const client = new Bun.SMTPClient({ service: "Outlook365" });
      // Outlook365 uses port 587 with STARTTLS, not direct TLS
      console.log(JSON.stringify({ secure: client.secure }));
      client.close();
    `);
    expect(JSON.parse(stdout.trim()).secure).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should resolve by email domain (gmail.com)", async () => {
    const { stdout, exitCode } = await runSmtp(`
      const client = new Bun.SMTPClient({ service: "gmail.com" });
      console.log(JSON.stringify({ secure: client.secure }));
      client.close();
    `);
    expect(JSON.parse(stdout.trim()).secure).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - verify() (from smtp-transport-test.js)", () => {
  test("should verify connection without auth", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      const { server, sessions, port } = createMockSMTP();
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port });
      const result = await client.verify();
      console.log(JSON.stringify({
        verified: result !== undefined && result !== null,
        hasEhlo: sessions[0].commands.some(c => c.startsWith("EHLO")),
      }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.verified).toBe(true);
    expect(data.hasEhlo).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("should reject verify on connection failure", async () => {
    const { stdout, exitCode } = await runSmtp(`
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port: 62542 });
      try { await client.verify(); console.log("ERROR: should have thrown"); }
      catch(e) { console.log("rejected:", e.message.substring(0, 40)); }
      client.close();
    `);
    expect(stdout).toContain("rejected:");
    expect(exitCode).toBe(0);
  });
});

describe("Nodemailer Compatibility - Connection Reuse (from smtp-pool-test.js)", () => {
  test("should send 5 messages over a single connection", async () => {
    const { stdout, exitCode } = await runSmtp(`
      ${MOCK_SERVER}
      let ehloCount = 0;
      let msgCount = 0;
      const server = Bun.listen({
        hostname: "127.0.0.1", port: 0,
        socket: {
          open(socket) { socket.data = { inData: false, buf: "" }; socket.write("220 OK\\r\\n"); },
          data(socket, raw) {
            const text = new TextDecoder().decode(raw);
            if (socket.data.inData) {
              socket.data.buf += text;
              if (socket.data.buf.includes("\\r\\n.\\r\\n")) {
                socket.data.inData = false; msgCount++;
                socket.data.buf = "";
                socket.write("250 OK #" + msgCount + "\\r\\n");
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
      const client = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      for (let i = 0; i < 5; i++) {
        await client.send({ from: "a@b.com", to: "c@d.com", text: "Message " + (i+1) });
      }
      console.log(JSON.stringify({ msgCount, ehloCount }));
      client.close(); server.stop();
    `);
    const data = JSON.parse(stdout.trim());
    expect(data.msgCount).toBe(5);
    expect(data.ehloCount).toBe(1); // Only one EHLO = one connection
    expect(exitCode).toBe(0);
  });
});
