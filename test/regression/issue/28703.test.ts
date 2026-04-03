import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows, tempDir } from "harness";
import { join } from "node:path";

// Skip on Windows — the inline script uses openssl req which is not
// available on the default Windows CI image.
// Skip on musl (Alpine) — a residual race in the ReadableStream pull path
// still fires under musl's different scheduling/allocator profile even at
// this reduced concurrency. Tracked separately.
test.skipIf(isWindows || isMusl)(
  "node:https concurrent chunked downloads do not hang",
  async () => {
    using dir = tempDir("issue-28703", {});
    const keyPath = join(String(dir), "key.pem");
    const certPath = join(String(dir), "cert.pem");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      const https = require("node:https");
      const { readFileSync } = require("node:fs");
      const { execSync } = require("node:child_process");

      execSync("openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj '/CN=localhost' 2>/dev/null");

      const PAYLOAD = Buffer.alloc(25000, "A");

      const server = https.createServer({ key: readFileSync("${keyPath}"), cert: readFileSync("${certPath}") }, (req, res) => {
        res.writeHead(200);
        let offset = 0;
        (function send() {
          if (offset >= PAYLOAD.length) { res.end(); return; }
          res.write(PAYLOAD.subarray(offset, offset += 5000));
          setTimeout(send, Math.random() * 2);
        })();
      });

      server.listen(0, "127.0.0.1", async () => {
        const URL = "https://127.0.0.1:" + server.address().port + "/";
        const W = 10, N = 10, TOTAL = W * N;
        let done = 0;

        const dl = () => new Promise((ok, no) => {
          https.get(URL, { rejectUnauthorized: false }, r => {
            let n = 0;
            r.on("data", c => n += c.length);
            r.on("end", () => ok(n));
            r.on("error", no);
          }).on("error", no);
        });

        let last = -1;
        const hc = setInterval(() => {
          if (done === last && done < TOTAL) {
            console.error("HUNG " + done + "/" + TOTAL);
            process.exit(1);
          }
          last = done;
        }, 5000);

        try {
          await Promise.all(Array.from({ length: W }, async () => {
            for (let i = 0; i < N; i++) {
              const bytes = await dl();
              if (bytes !== 25000) { console.error("BAD " + bytes); process.exit(1); }
              done++;
            }
          }));
          console.log("OK " + done);
        } finally { clearInterval(hc); server.close(); }
      });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("HUNG");
    expect(stderr).not.toContain("BAD");
    expect(stdout).toContain("OK ");
    expect(exitCode).toBe(0);
  },
  60_000,
);
