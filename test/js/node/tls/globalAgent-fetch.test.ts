import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunRun, tempDir } from "harness";
import { join } from "path";

// Server certificates
const serverKey = readFileSync(join(import.meta.dir, "fixtures", "agent1-key.pem"), "utf8");
const serverCert = readFileSync(join(import.meta.dir, "fixtures", "agent1-cert.pem"), "utf8");

// CA that signed the server cert
const ca1 = readFileSync(join(import.meta.dir, "fixtures", "ca1-cert.pem"), "utf8");

describe.concurrent("fetch uses globalAgent.options as fallback", () => {
  test("uses globalAgent.options.rejectUnauthorized for fetch", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from fetch");
  });

  test("uses globalAgent.options.ca for fetch requests", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello with CA");
  });

  test("per-request tls options override globalAgent.options in fetch", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello override");
  });

  test("uses globalAgent.connectOpts for fetch (HttpsProxyAgent compatibility)", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from connectOpts");
  });
});

describe.concurrent("fetch uses agent/dispatcher option for TLS fallback", () => {
  test("per-request agent.connectOpts takes precedence over globalAgent.options", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello with agent TLS");
  });

  test("dispatcher option works for TLS fallback (undici compatibility)", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello with dispatcher TLS");
  });

  test("dispatcher.connect option works for TLS fallback (undici.Agent compatibility)", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello with undici connect");
  });
});
