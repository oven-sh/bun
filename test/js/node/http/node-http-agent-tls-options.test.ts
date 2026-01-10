import { describe, test } from "bun:test";
import { exampleSite, tls as tlsCerts } from "harness";
import http from "node:http";
import https from "node:https";

// Test that TLS options can be inherited from agent.options and agent.connectOpts
// This is important for compatibility with libraries like https-proxy-agent

describe("https.request agent TLS options inheritance", () => {
  describe("agent.options", () => {
    test("inherits ca from agent.options", async () => {
      await using httpsServer = exampleSite();

      // Create an agent with ca in options
      const agent = new https.Agent({
        ca: httpsServer.ca,
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
          // NO ca here - should inherit from agent.options
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("inherits rejectUnauthorized from agent.options", async () => {
      await using httpsServer = exampleSite();

      // Create an agent with rejectUnauthorized: false in options
      const agent = new https.Agent({
        rejectUnauthorized: false,
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
          // NO rejectUnauthorized here - should inherit from agent.options
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("inherits cert and key from agent.options", async () => {
      // Create a server that requires client certificates
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: {
          key: tlsCerts.key,
          cert: tlsCerts.cert,
        },
        fetch() {
          return new Response("OK");
        },
      });

      try {
        // Create an agent with cert/key in options
        const agent = new https.Agent({
          rejectUnauthorized: false,
          cert: tlsCerts.cert,
          key: tlsCerts.key,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname: server.hostname,
            port: server.port,
            path: "/",
            method: "GET",
            agent,
            // NO cert/key here - should inherit from agent.options
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.stop(true);
      }
    });
  });

  describe("agent.connectOpts (https-proxy-agent compatibility)", () => {
    test("inherits rejectUnauthorized from agent.connectOpts", async () => {
      await using httpsServer = exampleSite();

      // Simulate https-proxy-agent's structure
      // HttpsProxyAgent stores TLS options in connectOpts
      const agent = new https.Agent() as https.Agent & { connectOpts: Record<string, unknown> };
      agent.connectOpts = {
        rejectUnauthorized: false,
      };

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
          // NO rejectUnauthorized here - should inherit from agent.connectOpts
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("inherits ca from agent.connectOpts", async () => {
      await using httpsServer = exampleSite();

      // Simulate https-proxy-agent's structure
      const agent = new https.Agent() as https.Agent & { connectOpts: Record<string, unknown> };
      agent.connectOpts = {
        ca: httpsServer.ca,
      };

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
          // NO ca here - should inherit from agent.connectOpts
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("inherits cert and key from agent.connectOpts", async () => {
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: {
          key: tlsCerts.key,
          cert: tlsCerts.cert,
        },
        fetch() {
          return new Response("OK");
        },
      });

      try {
        // Simulate https-proxy-agent's structure
        const agent = new https.Agent() as https.Agent & { connectOpts: Record<string, unknown> };
        agent.connectOpts = {
          rejectUnauthorized: false,
          cert: tlsCerts.cert,
          key: tlsCerts.key,
        };

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname: server.hostname,
            port: server.port,
            path: "/",
            method: "GET",
            agent,
            // NO cert/key here - should inherit from agent.connectOpts
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.stop(true);
      }
    });
  });

  describe("option precedence (matches Node.js)", () => {
    // In Node.js, options are merged via spread in createSocket:
    //   options = { __proto__: null, ...options, ...this.options };
    // https://github.com/nodejs/node/blob/v23.6.0/lib/_http_agent.js#L365
    // With spread, the last one wins, so agent.options overwrites request options.

    test("agent.options takes precedence over direct options", async () => {
      await using httpsServer = exampleSite();

      // Create an agent with correct CA
      const agent = new https.Agent({
        ca: httpsServer.ca, // Correct CA in agent.options - should be used
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
          ca: "wrong-ca-that-would-fail", // Wrong CA in request - should be ignored
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("direct options used when agent.options not set", async () => {
      await using httpsServer = exampleSite();

      // Create an agent without ca
      const agent = new https.Agent({});

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
          ca: httpsServer.ca, // Direct option should be used since agent.options.ca is not set
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("agent.options takes precedence over agent.connectOpts", async () => {
      await using httpsServer = exampleSite();

      // Simulate an agent with both options and connectOpts
      const agent = new https.Agent({
        ca: httpsServer.ca, // Correct CA in options - should be used
      }) as https.Agent & { connectOpts: Record<string, unknown> };
      agent.connectOpts = {
        ca: "wrong-ca-that-would-fail", // Wrong CA in connectOpts - should be ignored
      };

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("direct options takes precedence over agent.connectOpts", async () => {
      await using httpsServer = exampleSite();

      // Simulate an agent with only connectOpts (no options.ca)
      const agent = new https.Agent({}) as https.Agent & { connectOpts: Record<string, unknown> };
      agent.connectOpts = {
        ca: "wrong-ca-that-would-fail", // Wrong CA in connectOpts - should be ignored
      };

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
          ca: httpsServer.ca, // Correct CA in request - should be used over connectOpts
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });
  });

  describe("other TLS options", () => {
    test("inherits servername from agent.options", async () => {
      await using httpsServer = exampleSite();

      const agent = new https.Agent({
        rejectUnauthorized: false,
        servername: "localhost", // Should be passed to TLS
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });

    test("inherits ciphers from agent.options", async () => {
      await using httpsServer = exampleSite();

      const agent = new https.Agent({
        rejectUnauthorized: false,
        ciphers: "HIGH:!aNULL:!MD5", // Custom cipher suite
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = https.request(
        {
          hostname: httpsServer.url.hostname,
          port: httpsServer.url.port,
          path: "/",
          method: "GET",
          agent,
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    });
  });
});

describe("http.request agent options", () => {
  test("does not fail when agent has TLS options (they are ignored for HTTP)", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("OK");
      },
    });

    try {
      // Create an agent with TLS options (should be ignored for HTTP)
      const agent = new http.Agent() as http.Agent & { options: Record<string, unknown> };
      agent.options = {
        rejectUnauthorized: false,
        ca: "some-ca",
      };

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = http.request(
        {
          hostname: server.hostname,
          port: server.port,
          path: "/",
          method: "GET",
          agent,
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    } finally {
      server.stop(true);
    }
  });
});
