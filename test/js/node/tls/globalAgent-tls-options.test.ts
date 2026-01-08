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

    test("uses agent.connect.rejectUnauthorized (undici.Agent compatibility)", async () => {
      using dir = tempDir("test-https-agent-connect", {
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
            res.end('Hello from connect');
          });

          server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;

            // Use connect (undici.Agent style) instead of connectOpts
            const agent = new https.Agent();
            agent.connect = {
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
                process.exit(data === 'Hello from connect' ? 0 : 1);
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
      expect(stdout.trim()).toBe("Hello from connect");
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

    test("uses globalAgent.connectOpts for fetch (HttpsProxyAgent compatibility)", async () => {
      using dir = tempDir("test-fetch-connectOpts", {
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
            res.end('Hello from connectOpts');
          });

          server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;

            // Set connectOpts on globalAgent (like HttpsProxyAgent does)
            https.globalAgent.connectOpts = {
              rejectUnauthorized: false,
            };

            try {
              const response = await fetch(\`https://127.0.0.1:\${port}/\`);
              const text = await response.text();
              console.log(text);
              server.close();
              process.exit(text === 'Hello from connectOpts' ? 0 : 1);
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
      expect(stdout.trim()).toBe("Hello from connectOpts");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("fetch uses agent/dispatcher option for TLS fallback", () => {
    test("per-request agent.connectOpts takes precedence over globalAgent.options", async () => {
      using dir = tempDir("test-fetch-agent-connectOpts", {
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
            res.end('Hello with agent TLS');
          });

          server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;

            // globalAgent.options has rejectUnauthorized: true (would fail without CA)
            https.globalAgent.options.rejectUnauthorized = true;

            // Create an agent with connectOpts that allows self-signed certs
            const myAgent = {
              connectOpts: {
                rejectUnauthorized: false,
              },
            };

            try {
              // Pass agent option - should use myAgent.connectOpts instead of globalAgent.options
              const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
                agent: myAgent,
              });
              const text = await response.text();
              console.log(text);
              server.close();
              process.exit(text === 'Hello with agent TLS' ? 0 : 1);
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
      expect(stdout.trim()).toBe("Hello with agent TLS");
      expect(exitCode).toBe(0);
    });

    test("dispatcher option works for TLS fallback (undici compatibility)", async () => {
      using dir = tempDir("test-fetch-dispatcher", {
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
            res.end('Hello with dispatcher TLS');
          });

          server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;

            // globalAgent.options has rejectUnauthorized: true (would fail without CA)
            https.globalAgent.options.rejectUnauthorized = true;

            // Create a dispatcher (undici-style) with connectOpts
            const myDispatcher = {
              connectOpts: {
                rejectUnauthorized: false,
              },
            };

            try {
              // Pass dispatcher option - should use myDispatcher.connectOpts
              const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
                dispatcher: myDispatcher,
              });
              const text = await response.text();
              console.log(text);
              server.close();
              process.exit(text === 'Hello with dispatcher TLS' ? 0 : 1);
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
      expect(stdout.trim()).toBe("Hello with dispatcher TLS");
      expect(exitCode).toBe(0);
    });

    test("dispatcher.connect option works for TLS fallback (undici.Agent compatibility)", async () => {
      using dir = tempDir("test-fetch-dispatcher-connect", {
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
            res.end('Hello with undici connect');
          });

          server.listen(0, '127.0.0.1', async () => {
            const port = server.address().port;

            // globalAgent.options has rejectUnauthorized: true (would fail without CA)
            https.globalAgent.options.rejectUnauthorized = true;

            // Create a dispatcher using undici.Agent style with connect property
            const myDispatcher = {
              connect: {
                rejectUnauthorized: false,
              },
            };

            try {
              // Pass dispatcher option - should use myDispatcher.connect
              const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
                dispatcher: myDispatcher,
              });
              const text = await response.text();
              console.log(text);
              server.close();
              process.exit(text === 'Hello with undici connect' ? 0 : 1);
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
      expect(stdout.trim()).toBe("Hello with undici connect");
      expect(exitCode).toBe(0);
    });
  });
});
