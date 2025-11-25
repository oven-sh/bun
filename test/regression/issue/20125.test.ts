import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test(
  "request.clone().json() should not crash on swagger endpoints - issue #20125",
  async () => {
    using dir = tempDir("issue-20125", {
      "package.json": JSON.stringify({
        name: "issue-20125",
        dependencies: {
          elysia: "1.4.16",
          "@elysiajs/swagger": "1.3.1",
        },
      }),
      "server.ts": `
import { Elysia } from "elysia";
import swagger from "@elysiajs/swagger";

const RequestLogger = () =>
  new Elysia({ name: 'request-logger' }).onRequest(async ({ request }) => {
    try {
      const body = await request.clone().json()
      console.log('Body:', body)
    } catch (e) {
      // Expected to fail for empty bodies
    }
  })

const app = new Elysia()
  .use(swagger())
  .use(RequestLogger())
  .listen({ port: 0 });

console.log(\`READY:\${app.server.port}\`);
`,
    });

    // Install dependencies
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });

    await install.exited;
    expect(install.exitCode).toBe(0);

    // Start the server
    await using server = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready and extract port
    let port: number | undefined;
    const buffer: string[] = [];

    for await (const chunk of server.stdout) {
      const text = new TextDecoder().decode(chunk);
      buffer.push(text);
      const match = text.match(/READY:(\d+)/);
      if (match) {
        port = parseInt(match[1], 10);
        break;
      }
    }

    expect(port).toBeGreaterThan(0);

    // Make a request to the swagger endpoint that previously caused a crash in v1.2.15
    const response = await fetch(`http://localhost:${port}/swagger/json`);

    // The server should respond successfully (not crash)
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toBeDefined();
    expect(json.openapi).toBeDefined();

    // Verify server is still running by making another request
    const response2 = await fetch(`http://localhost:${port}/swagger`);
    expect(response2.status).toBe(200);
  },
  { timeout: 30_000 },
);
