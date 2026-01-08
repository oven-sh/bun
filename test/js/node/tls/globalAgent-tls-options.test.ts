import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Server certificates
const serverKey = readFileSync(join(import.meta.dir, "fixtures", "agent1-key.pem"), "utf8");
const serverCert = readFileSync(join(import.meta.dir, "fixtures", "agent1-cert.pem"), "utf8");

// CA that signed the server cert
const ca1 = readFileSync(join(import.meta.dir, "fixtures", "ca1-cert.pem"), "utf8");

describe("https.globalAgent.options TLS fallback", () => {
  describe.concurrent("https.request uses globalAgent.options", () => {
    test("uses globalAgent.options.rejectUnauthorized when no per-request option is provided", async () => {
      using dir = tempDir("test-globalAgent-reject", {
        "key.pem": serverKey,
        "cert.pem": serverCert,
        "test.js": `
          const https = require('https');
          const fs = require('fs');

          const serverTls = {
            key: fs.readFileSync('./key.pem', 'utf8'),
            cert: fs.readFileSync('./cert.pem', 'utf8'),
          };

          const server = https.createServer(serverTls, (req, res) => {
            res.writeHead(200);
            res.end('Hello');
          });

          server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;

            // Set globalAgent.options.rejectUnauthorized to false
            // This allows the request to succeed without CA verification
            https.globalAgent.options.rejectUnauthorized = false;

            https.get({
              hostname: '127.0.0.1',
              port,
              path: '/',
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                console.log(data);
                server.close();
                process.exit(data === 'Hello' ? 0 : 1);
              });
            }).on('error', (err) => {
              console.error(err.message);
              server.close();
              process.exit(1);
            });
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("Hello");
      expect(exitCode).toBe(0);
    });

    test("per-request rejectUnauthorized overrides globalAgent.options", async () => {
      using dir = tempDir("test-globalAgent-override-reject", {
        "key.pem": serverKey,
        "cert.pem": serverCert,
        "test.js": `
          const https = require('https');
          const fs = require('fs');

          const serverTls = {
            key: fs.readFileSync('./key.pem', 'utf8'),
            cert: fs.readFileSync('./cert.pem', 'utf8'),
          };

          const server = https.createServer(serverTls, (req, res) => {
            res.writeHead(200);
            res.end('Hello');
          });

          server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;

            // Set globalAgent.options.rejectUnauthorized to true (would fail)
            https.globalAgent.options.rejectUnauthorized = true;

            // Override per-request with false (should succeed)
            https.get({
              hostname: '127.0.0.1',
              port,
              path: '/',
              rejectUnauthorized: false, // Override
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                console.log(data);
                server.close();
                process.exit(data === 'Hello' ? 0 : 1);
              });
            }).on('error', (err) => {
              console.error(err.message);
              server.close();
              process.exit(1);
            });
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("Hello");
      expect(exitCode).toBe(0);
    });

    test("uses agent.connectOpts.rejectUnauthorized as fallback", async () => {
      using dir = tempDir("test-connectOpts-reject", {
        "key.pem": serverKey,
        "cert.pem": serverCert,
        "test.js": `
          const https = require('https');
          const fs = require('fs');

          const serverTls = {
            key: fs.readFileSync('./key.pem', 'utf8'),
            cert: fs.readFileSync('./cert.pem', 'utf8'),
          };

          const server = https.createServer(serverTls, (req, res) => {
            res.writeHead(200);
            res.end('Hello');
          });

          server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;

            // Use connectOpts instead of options (used by https-proxy-agent)
            const agent = new https.Agent();
            agent.connectOpts = {
              rejectUnauthorized: false,
            };

            https.get({
              hostname: '127.0.0.1',
              port,
              path: '/',
              agent,
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                console.log(data);
                server.close();
                process.exit(data === 'Hello' ? 0 : 1);
              });
            }).on('error', (err) => {
              console.error(err.message);
              server.close();
              process.exit(1);
            });
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("Hello");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("fetch uses globalAgent.options as fallback", () => {
    test("uses globalAgent.options.rejectUnauthorized for fetch", async () => {
      using dir = tempDir("test-fetch-reject", {
        "key.pem": serverKey,
        "cert.pem": serverCert,
        "test.js": `
          const https = require('https');
          const fs = require('fs');

          const serverTls = {
            key: fs.readFileSync('./key.pem', 'utf8'),
            cert: fs.readFileSync('./cert.pem', 'utf8'),
          };

          const server = https.createServer(serverTls, (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello from fetch');
          });

          server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;

            // Set globalAgent.options.rejectUnauthorized to false
            https.globalAgent.options.rejectUnauthorized = false;

            try {
              const response = await fetch(\`https://127.0.0.1:\${port}/\`);
              const text = await response.text();
              console.log(text);
              server.close();
              process.exit(text === 'Hello from fetch' ? 0 : 1);
            } catch (err) {
              console.error(err.message);
              server.close();
              process.exit(1);
            }
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("Hello from fetch");
      expect(exitCode).toBe(0);
    });

    test("uses globalAgent.options.ca for fetch requests", async () => {
      using dir = tempDir("test-fetch-ca", {
        "key.pem": serverKey,
        "cert.pem": serverCert,
        "ca.pem": ca1,
        "test.js": `
          const https = require('https');
          const fs = require('fs');

          const serverTls = {
            key: fs.readFileSync('./key.pem', 'utf8'),
            cert: fs.readFileSync('./cert.pem', 'utf8'),
          };
          const ca = fs.readFileSync('./ca.pem', 'utf8');

          const server = https.createServer(serverTls, (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello with CA');
          });

          server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;

            // Set globalAgent.options with CA and checkServerIdentity
            https.globalAgent.options.ca = ca;
            https.globalAgent.options.rejectUnauthorized = true;
            https.globalAgent.options.checkServerIdentity = () => {};

            try {
              const response = await fetch(\`https://127.0.0.1:\${port}/\`);
              const text = await response.text();
              console.log(text);
              server.close();
              process.exit(text === 'Hello with CA' ? 0 : 1);
            } catch (err) {
              console.error(err.message);
              server.close();
              process.exit(1);
            }
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("Hello with CA");
      expect(exitCode).toBe(0);
    });

    test("per-request tls options override globalAgent.options in fetch", async () => {
      using dir = tempDir("test-fetch-override", {
        "key.pem": serverKey,
        "cert.pem": serverCert,
        "test.js": `
          const https = require('https');
          const fs = require('fs');

          const serverTls = {
            key: fs.readFileSync('./key.pem', 'utf8'),
            cert: fs.readFileSync('./cert.pem', 'utf8'),
          };

          const server = https.createServer(serverTls, (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello override');
          });

          server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;

            // Set globalAgent.options.rejectUnauthorized to true (would fail without CA)
            https.globalAgent.options.rejectUnauthorized = true;

            try {
              // Override per-request
              const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
                tls: {
                  rejectUnauthorized: false,
                },
              });
              const text = await response.text();
              console.log(text);
              server.close();
              process.exit(text === 'Hello override' ? 0 : 1);
            } catch (err) {
              console.error(err.message);
              server.close();
              process.exit(1);
            }
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("Hello override");
      expect(exitCode).toBe(0);
    });
  });
});
