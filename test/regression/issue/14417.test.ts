import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, tempDirWithFiles } from "harness";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";

// Test for pfx option of https.Agent
describe.skip("https.Agent with pfx and ca options", () => {
  let testDir: string;
  let serverProcess: any;
  let serverPort: number;

  beforeAll(async () => {
    testDir = tempDirWithFiles("https-agent-pfx", {});

    // Generate self-signed certificates
    // Create private key and certificate
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' -keyout "${join(testDir, "private-key.pem")}" -out "${join(testDir, "certificate.pem")}" 2>/dev/null`,
      { encoding: "utf-8" },
    );

    // Create pfx file (PKCS#12 format)
    execSync(
      `openssl pkcs12 -certpbe AES-256-CBC -export -out "${join(testDir, "test_cert.pfx")}" -inkey "${join(testDir, "private-key.pem")}" -in "${join(testDir, "certificate.pem")}" -passout pass:sample 2>/dev/null`,
      { encoding: "utf-8" },
    );

    // Create server script
    const serverScript = `
import {readFileSync} from 'node:fs'
import {createServer} from 'node:https'

const server = createServer(
  {
    key: readFileSync('${join(testDir, "private-key.pem")}'),
    cert: readFileSync('${join(testDir, "certificate.pem")}'),
    requestCert: true,
    ca: [readFileSync('${join(testDir, "certificate.pem")}')],
  },
  (req, res) => {
    const clientCert = req.socket.getPeerCertificate()

    if (req.client.authorized) {
      res.writeHead(200)
      res.end(JSON.stringify({ status: 'authorized', cn: clientCert.subject.CN }))
      return
    }
    if (clientCert && clientCert.subject) {
      res.writeHead(403)
      res.end(JSON.stringify({ status: 'forbidden' }))
      return
    }
    res.writeHead(401)
    res.end(JSON.stringify({ status: 'unauthorized' }))
  },
).listen(0, () => {
  console.log('SERVER_PORT:' + server.address().port)
})
`;

    writeFileSync(join(testDir, "server.js"), serverScript);

    // Start the server using Node.js (since we need a working HTTPS server with client cert)
    serverProcess = Bun.spawn({
      cmd: ["node", join(testDir, "server.js")],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Wait for server to start and get the port
    const output = await serverProcess.stdout.getReader().read();
    const text = new TextDecoder().decode(output.value);
    const match = text.match(/SERVER_PORT:(\d+)/);
    if (!match) {
      throw new Error("Failed to get server port: " + text);
    }
    serverPort = parseInt(match[1], 10);
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  test("https.Agent should respect pfx option", async () => {
    const pfxBuffer = readFileSync(join(testDir, "test_cert.pfx"));
    const caBuffer = readFileSync(join(testDir, "certificate.pem"));

    const agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: "sample",
      ca: caBuffer,
    });

    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        `https://localhost:${serverPort}`,
        {
          method: "GET",
          agent: agent,
        },
        res => {
          let body = "";
          res.on("data", chunk => (body += chunk));
          res.on("end", () => {
            resolve({ statusCode: res.statusCode!, body });
          });
        },
      );

      req.on("error", reject);
      req.end();
    });

    expect(result.statusCode).toBe(200);
    const response = JSON.parse(result.body);
    expect(response.status).toBe("authorized");
    expect(response.cn).toBe("localhost");
  });

  test("https.Agent should respect ca option", async () => {
    const pfxBuffer = readFileSync(join(testDir, "test_cert.pfx"));
    const caBuffer = readFileSync(join(testDir, "certificate.pem"));

    const agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: "sample",
      ca: caBuffer,
    });

    // Should not throw TLS error because ca is respected
    await expect(
      new Promise((resolve, reject) => {
        const req = https.request(
          `https://localhost:${serverPort}`,
          {
            method: "GET",
            agent: agent,
          },
          res => {
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      }),
    ).resolves.toBe(200);
  });

  test("https.Agent should respect cert, key, and passphrase options", async () => {
    const certBuffer = readFileSync(join(testDir, "certificate.pem"));
    const keyBuffer = readFileSync(join(testDir, "private-key.pem"));
    const caBuffer = readFileSync(join(testDir, "certificate.pem"));

    const agent = new https.Agent({
      cert: certBuffer,
      key: keyBuffer,
      ca: caBuffer,
    });

    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        `https://localhost:${serverPort}`,
        {
          method: "GET",
          agent: agent,
        },
        res => {
          let body = "";
          res.on("data", chunk => (body += chunk));
          res.on("end", () => {
            resolve({ statusCode: res.statusCode!, body });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(result.statusCode).toBe(200);
    const response = JSON.parse(result.body);
    expect(response.status).toBe("authorized");
  });

  test("pfx option should override cert and key options in agent", async () => {
    const pfxBuffer = readFileSync(join(testDir, "test_cert.pfx"));
    const caBuffer = readFileSync(join(testDir, "certificate.pem"));

    // pfx should be used, not the invalid cert/key
    const agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: "sample",
      ca: caBuffer,
      cert: Buffer.from("invalid-cert"),
      key: Buffer.from("invalid-key"),
    });

    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        `https://localhost:${serverPort}`,
        {
          method: "GET",
          agent: agent,
        },
        res => {
          let body = "";
          res.on("data", chunk => (body += chunk));
          res.on("end", () => {
            resolve({ statusCode: res.statusCode!, body });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(result.statusCode).toBe(200);
  });

  test("request options should override agent options", async () => {
    const pfxBuffer = readFileSync(join(testDir, "test_cert.pfx"));
    const caBuffer = readFileSync(join(testDir, "certificate.pem"));

    // Agent has invalid options, but request has valid ones
    const agent = new https.Agent({
      pfx: Buffer.from("invalid"),
      passphrase: "wrong",
    });

    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        `https://localhost:${serverPort}`,
        {
          method: "GET",
          agent: agent,
          pfx: pfxBuffer,
          passphrase: "sample",
          ca: caBuffer,
        },
        res => {
          let body = "";
          res.on("data", chunk => (body += chunk));
          res.on("end", () => {
            resolve({ statusCode: res.statusCode!, body });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(result.statusCode).toBe(200);
  });
});
