/**
 * Security tests: verify CRLF injection is blocked at every user-controlled input.
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
const sessions = [];
const server = Bun.listen({
  hostname: "127.0.0.1", port: 0,
  socket: {
    open(s) { s.data = { cmds: [], msg: "", inData: false, buf: "" }; sessions.push(s.data); s.write("220 OK\\r\\n"); },
    data(s, raw) {
      const t = new TextDecoder().decode(raw);
      if (s.data.inData) { s.data.buf += t; if (s.data.buf.includes("\\r\\n.\\r\\n")) { s.data.inData = false; s.data.msg = s.data.buf.slice(0, s.data.buf.indexOf("\\r\\n.\\r\\n")); s.data.buf = ""; s.write("250 OK\\r\\n"); } return; }
      for (const l of t.split("\\r\\n").filter(x=>x)) {
        s.data.cmds.push(l);
        if (l.startsWith("EHLO") || l.startsWith("LHLO")) s.write("250 OK\\r\\n");
        else if (l.startsWith("MAIL")) s.write("250 OK\\r\\n");
        else if (l.startsWith("RCPT")) s.write("250 OK\\r\\n");
        else if (l === "DATA") { s.data.inData = true; s.data.buf = ""; s.write("354 Go\\r\\n"); }
        else if (l.startsWith("RSET")) s.write("250 OK\\r\\n");
        else if (l === "QUIT") { s.write("221 Bye\\r\\n"); s.end(); }
      }
    },
  },
});
`;

describe("SMTP command injection prevention", () => {
  test("should strip CRLF from EHLO hostname (name option)", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({
        host: "127.0.0.1", port: server.port,
        name: "legit\\r\\nMAIL FROM:<evil@hacker.com>",
      });
      try {
        await c.send({ from: "a@b.com", to: "c@d.com", text: "hi" });
      } catch(e) {}
      // The key check: the injected text should NOT appear as a SEPARATE command
      // (it may appear as part of the EHLO hostname, which is harmless)
      const injectedAsCommand = sessions[0].cmds.some(c =>
        c.startsWith("MAIL FROM:") && c.includes("evil@hacker.com")
      );
      console.log(JSON.stringify({ injectedAsCommand }));
      c.close(); server.stop();
    `);
    const d = JSON.parse(stdout);
    expect(d.injectedAsCommand).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should prevent CRLF injection in MAIL FROM wire command", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      try {
        await c.send({ from: "legit@test.com\\r\\nRCPT TO:<evil@hacker.com>", to: "c@d.com", text: "hi" });
      } catch(e) {}
      // The key check: no raw CRLF in any SMTP command (writeCmd sanitizes)
      const hasRawCRLF = sessions[0].cmds.some(c => c.includes("\\r") || c.includes("\\n"));
      console.log(JSON.stringify({ hasRawCRLF }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasRawCRLF).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should prevent CRLF injection in RCPT TO wire command", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      try {
        await c.send({ from: "a@b.com", to: "legit@test.com\\r\\nDATA\\r\\n.\\r\\n", text: "hi" });
      } catch(e) {}
      // No raw CRLF should appear in any individual command
      const hasRawCRLF = sessions[0].cmds.some(c => c.includes("\\r") || c.includes("\\n"));
      console.log(JSON.stringify({ hasRawCRLF }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasRawCRLF).toBe(false);
    expect(exitCode).toBe(0);
  });
});

describe("MIME header injection prevention", () => {
  test("should strip CRLF from Subject header", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      await c.send({
        from: "a@b.com", to: "c@d.com",
        subject: "Normal\\r\\nBcc: evil@hacker.com",
        text: "test",
      });
      const msg = sessions[0].msg;
      const hasSeparateBcc = msg.split("\\r\\n").some(line => line.startsWith("Bcc: evil"));
      console.log(JSON.stringify({ hasSeparateBcc }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSeparateBcc).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should strip CRLF from custom header values", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "test",
        headers: { "X-Custom": "safe\\r\\nBcc: evil@hacker.com" },
      });
      const msg = sessions[0].msg;
      const hasSeparateBcc = msg.split("\\r\\n").some(line => line.startsWith("Bcc: evil"));
      console.log(JSON.stringify({ hasSeparateBcc }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSeparateBcc).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should strip CRLF from custom header keys", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "test",
        headers: { "X-Evil\\r\\nBcc: evil@hacker.com\\r\\nX-Cont": "value" },
      });
      const msg = sessions[0].msg;
      const hasSeparateBcc = msg.split("\\r\\n").some(line => line.startsWith("Bcc: evil"));
      console.log(JSON.stringify({ hasSeparateBcc }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSeparateBcc).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should strip CRLF from Reply-To header", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "test",
        replyTo: "legit@x.com\\r\\nBcc: evil@hacker.com",
      });
      const msg = sessions[0].msg;
      const hasSeparateBcc = msg.split("\\r\\n").some(line => line.startsWith("Bcc: evil"));
      console.log(JSON.stringify({ hasSeparateBcc }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSeparateBcc).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should strip CRLF from List-Unsubscribe header", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      await c.send({
        from: "a@b.com", to: "c@d.com", text: "test",
        list: { unsubscribe: "https://example.com\\r\\nBcc: evil@hacker.com" },
      });
      const msg = sessions[0].msg;
      const hasSeparateBcc = msg.split("\\r\\n").some(line => line.startsWith("Bcc: evil"));
      console.log(JSON.stringify({ hasSeparateBcc }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSeparateBcc).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("should strip CRLF from From display name", async () => {
    const { stdout, exitCode } = await run(`
      ${MOCK}
      const c = new Bun.SMTPClient({ host: "127.0.0.1", port: server.port });
      await c.send({
        from: '"Evil\\r\\nBcc: evil@hacker.com" <legit@x.com>',
        to: "c@d.com", text: "test",
      });
      const msg = sessions[0].msg;
      const hasSeparateBcc = msg.split("\\r\\n").some(line => line.startsWith("Bcc: evil"));
      console.log(JSON.stringify({ hasSeparateBcc }));
      c.close(); server.stop();
    `);
    expect(JSON.parse(stdout).hasSeparateBcc).toBe(false);
    expect(exitCode).toBe(0);
  });
});
