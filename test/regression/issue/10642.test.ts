import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";

test("node-fetch should respect https.Agent rejectUnauthorized option", async () => {
  // Create a temp directory with a test script
  using dir = tempDir("node-fetch-agent-test", {
    "test.mjs": `
import nodefetch from 'node-fetch';
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false
});

const url = process.argv[2];
try {
  const response = await nodefetch(url, { agent });
  console.log("STATUS:" + response.status);
  const text = await response.text();
  console.log("BODY:" + text);
} catch (error) {
  console.log("ERROR:" + error.code + ":" + error.message);
}
`,
  });

  // Start the self-signed HTTPS server
  const server = Bun.serve({
    port: 0,
    tls,
    fetch(req) {
      return new Response("Hello from self-signed server!");
    },
  });

  try {
    const url = `https://localhost:${server.port}/`;

    // Test with rejectUnauthorized: false - should succeed
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs", url],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed with status 200
    expect(stdout).toContain("STATUS:200");
    expect(stdout).toContain("BODY:Hello from self-signed server!");
    expect(exitCode).toBe(0);
  } finally {
    server.stop();
  }
});

test("node-fetch should fail with self-signed cert when agent is not provided", async () => {
  using dir = tempDir("node-fetch-no-agent-test", {
    "test.mjs": `
import nodefetch from 'node-fetch';

const url = process.argv[2];
try {
  const response = await nodefetch(url);
  console.log("STATUS:" + response.status);
} catch (error) {
  console.log("ERROR:" + (error.code || error.cause?.code || "UNKNOWN"));
}
`,
  });

  const server = Bun.serve({
    port: 0,
    tls,
    fetch(req) {
      return new Response("Hello from self-signed server!");
    },
  });

  try {
    const url = `https://localhost:${server.port}/`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs", url],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should fail with certificate error
    expect(stdout).toContain("ERROR:");
    expect(stdout).toMatch(/DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT/);
  } finally {
    server.stop();
  }
});

test("node-fetch should respect agent with ca certificate", async () => {
  using dir = tempDir("node-fetch-agent-ca-test", {
    "test.mjs": `
import nodefetch from 'node-fetch';
import https from 'https';

const ca = process.argv[3];
const agent = new https.Agent({ ca });

const url = process.argv[2];
try {
  const response = await nodefetch(url, { agent });
  console.log("STATUS:" + response.status);
  const text = await response.text();
  console.log("BODY:" + text);
} catch (error) {
  console.log("ERROR:" + (error.code || error.cause?.code || "UNKNOWN") + ":" + error.message);
}
`,
  });

  const server = Bun.serve({
    port: 0,
    tls,
    fetch(req) {
      return new Response("Hello with CA!");
    },
  });

  try {
    const url = `https://localhost:${server.port}/`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs", url, tls.cert],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed with the CA certificate
    expect(stdout).toContain("STATUS:200");
    expect(stdout).toContain("BODY:Hello with CA!");
    expect(exitCode).toBe(0);
  } finally {
    server.stop();
  }
});

test("undici fetch should respect dispatcher with rejectUnauthorized option", async () => {
  using dir = tempDir("undici-dispatcher-test", {
    "test.mjs": `
import { fetch } from 'undici';

// Create a simple dispatcher-like object with connect options
const dispatcher = {
  options: {
    rejectUnauthorized: false
  }
};

const url = process.argv[2];
try {
  const response = await fetch(url, { dispatcher });
  console.log("STATUS:" + response.status);
  const text = await response.text();
  console.log("BODY:" + text);
} catch (error) {
  console.log("ERROR:" + (error.code || error.cause?.code || "UNKNOWN") + ":" + error.message);
}
`,
  });

  const server = Bun.serve({
    port: 0,
    tls,
    fetch(req) {
      return new Response("Hello from undici!");
    },
  });

  try {
    const url = `https://localhost:${server.port}/`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs", url],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed with status 200
    expect(stdout).toContain("STATUS:200");
    expect(stdout).toContain("BODY:Hello from undici!");
    expect(exitCode).toBe(0);
  } finally {
    server.stop();
  }
});
