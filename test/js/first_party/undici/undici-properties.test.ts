import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("undici class properties", () => {
  test("undici classes store options and connect properties correctly", async () => {
    using dir = tempDir("test-undici-props", {
      "test.js": `
        const { Agent, Dispatcher, Pool, Client, ProxyAgent, EnvHttpProxyAgent, RetryAgent } = require('undici');

        // Test Agent
        const agent = new Agent({
          connect: {
            rejectUnauthorized: false,
            ca: 'test-ca',
          },
        });

        if (!agent.options) {
          console.error('Agent.options is missing');
          process.exit(1);
        }
        if (!agent.connect) {
          console.error('Agent.connect is missing');
          process.exit(1);
        }
        if (agent.connect.rejectUnauthorized !== false) {
          console.error('Agent.connect.rejectUnauthorized is not false');
          process.exit(1);
        }
        if (agent.connect.ca !== 'test-ca') {
          console.error('Agent.connect.ca is not test-ca');
          process.exit(1);
        }

        // Test Dispatcher
        const dispatcher = new Dispatcher({
          connect: {
            rejectUnauthorized: false,
          },
        });
        if (!dispatcher.options || !dispatcher.connect) {
          console.error('Dispatcher options/connect missing');
          process.exit(1);
        }

        // Test Pool
        const pool = new Pool('http://localhost', {
          connect: {
            rejectUnauthorized: false,
          },
        });
        if (!pool.options || !pool.connect) {
          console.error('Pool options/connect missing');
          process.exit(1);
        }

        // Test Client
        const client = new Client('http://localhost', {
          connect: {
            rejectUnauthorized: false,
          },
        });
        if (!client.options || !client.connect) {
          console.error('Client options/connect missing');
          process.exit(1);
        }

        // Test ProxyAgent
        const proxyAgent = new ProxyAgent({
          connect: {
            rejectUnauthorized: false,
          },
        });
        if (!proxyAgent.options || !proxyAgent.connect) {
          console.error('ProxyAgent options/connect missing');
          process.exit(1);
        }

        // Test EnvHttpProxyAgent
        const envAgent = new EnvHttpProxyAgent({
          connect: {
            rejectUnauthorized: false,
          },
        });
        if (!envAgent.options || !envAgent.connect) {
          console.error('EnvHttpProxyAgent options/connect missing');
          process.exit(1);
        }

        // Test RetryAgent - also test that dispatcher is stored
        const retryAgent = new RetryAgent(dispatcher, {
          connect: {
            rejectUnauthorized: false,
          },
        });
        if (!retryAgent.options || !retryAgent.connect) {
          console.error('RetryAgent options/connect missing');
          process.exit(1);
        }
        if (retryAgent.dispatcher !== dispatcher) {
          console.error('RetryAgent.dispatcher should reference the passed dispatcher');
          process.exit(1);
        }

        // Test empty constructor
        const emptyAgent = new Agent();
        if (emptyAgent.options !== undefined || emptyAgent.connect !== undefined) {
          console.error('Empty Agent should have undefined options/connect');
          process.exit(1);
        }

        console.log('All undici classes store options correctly');
        process.exit(0);
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
    expect(stdout.trim()).toBe("All undici classes store options correctly");
    expect(exitCode).toBe(0);
  });
});
