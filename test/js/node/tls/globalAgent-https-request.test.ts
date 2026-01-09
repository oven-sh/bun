import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunRun, tempDir } from "harness";
import { join } from "path";

// Server certificates
const serverKey = readFileSync(join(import.meta.dir, "fixtures", "agent1-key.pem"), "utf8");
const serverCert = readFileSync(join(import.meta.dir, "fixtures", "agent1-cert.pem"), "utf8");

describe.concurrent("https.request uses globalAgent.options", () => {
  test("uses globalAgent.options.rejectUnauthorized when no per-request option is provided", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello");
  });

  test("per-request rejectUnauthorized overrides globalAgent.options", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello");
  });

  test("uses agent.connectOpts.rejectUnauthorized as fallback", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello");
  });

  test("uses agent.connect.rejectUnauthorized (undici.Agent compatibility)", () => {
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

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from connect");
  });
});
