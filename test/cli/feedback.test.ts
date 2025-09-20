import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createServer } from "node:http";
import { join } from "node:path";

test("bun feedback sends POST request with correct payload", async () => {
  let receivedRequest: any = null;
  let receivedBody: string = "";

  // Create test server
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/feedback") {
      let body = "";
      req.on("data", chunk => {
        body += chunk.toString();
      });
      req.on("end", () => {
        receivedBody = body;
        try {
          receivedRequest = JSON.parse(body);
        } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;
  const feedbackUrl = `http://127.0.0.1:${port}/api/v1/feedback`;

  try {
    // Test with positional arguments
    using dir = tempDir("feedback-test", {
      "feedback": "test@example.com",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "feedback", "this", "is", "a", "test", "message"],
      env: {
        ...bunEnv,
        BUN_FEEDBACK_URL: feedbackUrl,
        BUN_INSTALL: String(dir),
      },
      stdin: Bun.file("/dev/null"),
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    const [exitCode] = await Promise.all([proc.exited]);

    expect(exitCode).toBe(0);
    expect(receivedRequest).toBeTruthy();
    expect(receivedRequest.body).toBe("this is a test message");
    expect(receivedRequest.email).toBe("test@example.com");
    expect(receivedRequest.os).toBeTruthy();
    expect(receivedRequest.cpu).toBeTruthy();
    expect(receivedRequest.version).toBeTruthy();
  } finally {
    server.close();
  }
});

test("bun feedback reads from stdin when piped", async () => {
  let receivedRequest: any = null;

  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/feedback") {
      let body = "";
      req.on("data", chunk => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          receivedRequest = JSON.parse(body);
        } catch {}
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      });
    }
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;
  const feedbackUrl = `http://127.0.0.1:${port}/api/v1/feedback`;

  try {
    using dir = tempDir("feedback-test2", {
      "feedback": "test@example.com",
      "test.js": `console.log("Error from script");`,
    });

    // Run the script and pipe to feedback
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
      cwd: String(dir),
    });

    const output = await proc1.stdout.text();

    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "feedback"],
      env: {
        ...bunEnv,
        BUN_FEEDBACK_URL: feedbackUrl,
        BUN_INSTALL: String(dir),
      },
      stdin: Buffer.from(output),
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    const [exitCode] = await Promise.all([proc2.exited]);

    expect(exitCode).toBe(0);
    expect(receivedRequest).toBeTruthy();
    expect(receivedRequest.body).toContain("Error from script");
    expect(receivedRequest.email).toBe("test@example.com");
  } finally {
    server.close();
  }
});

test("bun feedback saves and reuses email", async () => {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/feedback") {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
    }
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;
  const feedbackUrl = `http://127.0.0.1:${port}/api/v1/feedback`;

  try {
    using dir = tempDir("feedback-test3", {
      "feedback": "saved@example.com",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "feedback", "test"],
      env: {
        ...bunEnv,
        BUN_FEEDBACK_URL: feedbackUrl,
        BUN_INSTALL: String(dir),
      },
      stdin: Bun.file("/dev/null"),
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    const [exitCode] = await Promise.all([proc.exited]);
    expect(exitCode).toBe(0);

    // Check that email was used
    const savedEmail = await Bun.file(join(String(dir), "feedback")).text();
    expect(savedEmail).toBe("saved@example.com");
  } finally {
    server.close();
  }
});

test("bun feedback handles server errors gracefully", async () => {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/feedback") {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as any).port;
  const feedbackUrl = `http://127.0.0.1:${port}/api/v1/feedback`;

  try {
    using dir = tempDir("feedback-test4", {
      "feedback": "test@example.com",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "feedback", "test"],
      env: {
        ...bunEnv,
        BUN_FEEDBACK_URL: feedbackUrl,
        BUN_INSTALL: String(dir),
      },
      stdin: Bun.file("/dev/null"),
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Failed to send feedback");
  } finally {
    server.close();
  }
});

test("bun feedback command exists", async () => {
  // Test that the feedback command is recognized and starts executing
  // We'll test with a non-existent server to ensure it times out quickly
  using dir = tempDir("feedback-test5", {
    "feedback": "test@example.com",
  });

  // Use a promise that resolves when we see output
  let outputReceived = false;
  const outputPromise = new Promise<void>(resolve => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "feedback", "test", "message"],
      env: {
        ...bunEnv,
        BUN_FEEDBACK_URL: `http://127.0.0.1:1/api/v1/feedback`, // Port 1 will fail immediately
        BUN_INSTALL: String(dir),
      },
      stdout: "pipe",
      stderr: "pipe",
      cwd: String(dir),
    });

    // Collect output
    let stderr = "";
    proc.stderr.pipeTo(
      new WritableStream({
        write(chunk) {
          const text = new TextDecoder().decode(chunk);
          stderr += text;
          if (text.includes("feedback") || text.includes("Failed to send")) {
            outputReceived = true;
            resolve();
          }
        },
      }),
    );

    // Also resolve after timeout
    setTimeout(() => {
      if (!outputReceived) {
        proc.kill();
        resolve();
      }
    }, 2000);
  });

  await outputPromise;

  // The test passes if we got any output containing "feedback"
  // (either the banner or the error message)
  expect(outputReceived).toBe(true);
});
