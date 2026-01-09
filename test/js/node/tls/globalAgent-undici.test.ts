import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunRun, tempDir } from "harness";
import { join } from "path";

// Server certificates
const serverKey = readFileSync(join(import.meta.dir, "fixtures", "agent1-key.pem"), "utf8");
const serverCert = readFileSync(join(import.meta.dir, "fixtures", "agent1-cert.pem"), "utf8");

describe.concurrent("undici module integration", () => {
  test("undici.Agent with connect options works with Bun's fetch", () => {
    using dir = tempDir("test-undici-agent-fetch", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { Agent } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from undici.Agent');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // Create undici.Agent with connect options
          const agent = new Agent({
            connect: {
              rejectUnauthorized: false,
            },
          });

          try {
            // Use Bun's fetch with undici.Agent as dispatcher
            const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
              dispatcher: agent,
            });
            const text = await response.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from undici.Agent' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from undici.Agent");
  });

  test("undici.Pool with connect options works with Bun's fetch", () => {
    using dir = tempDir("test-undici-pool-fetch", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { Pool } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from undici.Pool');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // Create undici.Pool with connect options
          const pool = new Pool(\`https://127.0.0.1:\${port}\`, {
            connect: {
              rejectUnauthorized: false,
            },
          });

          try {
            // Use Bun's fetch with undici.Pool as dispatcher
            const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
              dispatcher: pool,
            });
            const text = await response.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from undici.Pool' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from undici.Pool");
  });

  test("undici.Client with connect options works with Bun's fetch", () => {
    using dir = tempDir("test-undici-client-fetch", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { Client } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from undici.Client');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // Create undici.Client with connect options
          const client = new Client(\`https://127.0.0.1:\${port}\`, {
            connect: {
              rejectUnauthorized: false,
            },
          });

          try {
            // Use Bun's fetch with undici.Client as dispatcher
            const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
              dispatcher: client,
            });
            const text = await response.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from undici.Client' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from undici.Client");
  });

  test("undici.ProxyAgent with connect options works with Bun's fetch", () => {
    using dir = tempDir("test-undici-proxyagent-fetch", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { ProxyAgent } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from undici.ProxyAgent');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // Create undici.ProxyAgent with connect options
          const proxyAgent = new ProxyAgent({
            connect: {
              rejectUnauthorized: false,
            },
          });

          try {
            // Use Bun's fetch with undici.ProxyAgent as dispatcher
            const response = await fetch(\`https://127.0.0.1:\${port}/\`, {
              dispatcher: proxyAgent,
            });
            const text = await response.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from undici.ProxyAgent' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from undici.ProxyAgent");
  });

  test("undici.fetch uses https.globalAgent.options as fallback", () => {
    using dir = tempDir("test-undici-fetch-globalagent", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { fetch: undiciFetch } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from undici.fetch');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // Set globalAgent.options.rejectUnauthorized to false
          https.globalAgent.options.rejectUnauthorized = false;

          try {
            // Use undici.fetch - should use globalAgent.options as fallback
            const response = await undiciFetch(\`https://127.0.0.1:\${port}/\`);
            const text = await response.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from undici.fetch' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from undici.fetch");
  });

  test("undici.fetch with dispatcher uses dispatcher.connect for TLS", () => {
    using dir = tempDir("test-undici-fetch-dispatcher", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { fetch: undiciFetch, Agent } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from undici.fetch with Agent');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // globalAgent.options has rejectUnauthorized: true (would fail)
          https.globalAgent.options.rejectUnauthorized = true;

          // Create undici.Agent with connect options
          const agent = new Agent({
            connect: {
              rejectUnauthorized: false,
            },
          });

          try {
            // Use undici.fetch with dispatcher
            const response = await undiciFetch(\`https://127.0.0.1:\${port}/\`, {
              dispatcher: agent,
            });
            const text = await response.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from undici.fetch with Agent' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from undici.fetch with Agent");
  });

  test("undici.setGlobalDispatcher affects fetch TLS options", () => {
    using dir = tempDir("test-undici-setglobaldispatcher", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { Agent, setGlobalDispatcher, fetch: undiciFetch } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from global dispatcher');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // Create undici.Agent with connect options and set as global dispatcher
          const agent = new Agent({
            connect: {
              rejectUnauthorized: false,
            },
          });
          setGlobalDispatcher(agent);

          try {
            // Use undici.fetch - should use global dispatcher's connect options
            const response = await undiciFetch(\`https://127.0.0.1:\${port}/\`);
            const text = await response.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from global dispatcher' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from global dispatcher");
  });

  test("undici.request uses https.globalAgent.options as fallback", () => {
    using dir = tempDir("test-undici-request-globalagent", {
      "key.pem": serverKey,
      "cert.pem": serverCert,
      "test.js": `
        const https = require('https');
        const fs = require('fs');
        const { request } = require('undici');

        const serverTls = {
          key: fs.readFileSync('./key.pem', 'utf8'),
          cert: fs.readFileSync('./cert.pem', 'utf8'),
        };

        const server = https.createServer(serverTls, (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from undici.request');
        });

        server.listen(0, '127.0.0.1', async () => {
          const port = server.address().port;

          // Set globalAgent.options.rejectUnauthorized to false
          https.globalAgent.options.rejectUnauthorized = false;

          try {
            // Use undici.request - should use globalAgent.options as fallback
            const { body } = await request(\`https://127.0.0.1:\${port}/\`);
            const text = await body.text();
            console.log(text);
            server.close();
            process.exit(text === 'Hello from undici.request' ? 0 : 1);
          } catch (err) {
            console.error(err.message);
            server.close();
            process.exit(1);
          }
        });
      `,
    });

    const { stdout } = bunRun(join(String(dir), "test.js"));
    expect(stdout).toBe("Hello from undici.request");
  });
});
