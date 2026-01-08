import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { request } from "undici";

import { createServer } from "../../../http-test-server";

describe("undici", () => {
  let serverCtl: ReturnType<typeof createServer>;
  let hostUrl: string;
  let port: number;
  let host: string;

  beforeAll(() => {
    serverCtl = createServer();
    port = serverCtl.port;
    host = `${serverCtl.hostname}:${port}`;
    hostUrl = `http://${host}`;
  });

  afterAll(() => {
    serverCtl.stop();
  });

  describe("request", () => {
    it("should make a GET request when passed a URL string", async () => {
      const { body } = await request(`${hostUrl}/get`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    it("should error when body has already been consumed", async () => {
      const { body } = await request(`${hostUrl}/get`);
      await body.json();
      expect(body.bodyUsed).toBe(true);
      try {
        await body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("unusable");
      }
    });

    it("should make a POST request when provided a body and POST method", async () => {
      const { body } = await request(`${hostUrl}/post`, {
        method: "POST",
        body: "Hello world",
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { data: string };
      expect(json.data).toBe("Hello world");
    });

    it("should accept a URL class object", async () => {
      const { body } = await request(new URL(`${hostUrl}/get`));
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    // it("should accept an undici UrlObject", async () => {
    //   // @ts-ignore
    //   const { body } = await request({ protocol: "https:", hostname: host, path: "/get" });
    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { url: string };
    //   expect(json.url).toBe(`${hostUrl}/get`);
    // });

    it("should prevent body from being attached to GET or HEAD requests", async () => {
      try {
        await request(`${hostUrl}/get`, {
          method: "GET",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }

      try {
        await request(`${hostUrl}/head`, {
          method: "HEAD",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }
    });

    it("should allow a query string to be passed", async () => {
      const { body } = await request(`${hostUrl}/get?foo=bar`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { args: { foo: string } };
      expect(json.args.foo).toBe("bar");

      const { body: body2 } = await request(`${hostUrl}/get`, {
        query: { foo: "bar" },
      });
      expect(body2).toBeDefined();
      const json2 = (await body2.json()) as { args: { foo: string } };
      expect(json2.args.foo).toBe("bar");
    });

    it("should throw on HTTP 4xx or 5xx error when throwOnError is true", async () => {
      try {
        await request(`${hostUrl}/status/404`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 404");
      }

      try {
        await request(`${hostUrl}/status/500`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 500");
      }
    });

    it("should allow us to abort the request with a signal", async () => {
      const controller = new AbortController();
      try {
        setTimeout(() => controller.abort(), 500);
        const req = await request(`${hostUrl}/delay/5`, {
          signal: controller.signal,
        });
        await req.body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("The operation was aborted.");
      }
    });

    it("should properly append headers to the request", async () => {
      const { body } = await request(`${hostUrl}/headers`, {
        headers: {
          "x-foo": "bar",
        },
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { headers: { "x-foo": string } };
      expect(json.headers["x-foo"]).toBe("bar");
    });

    // it("should allow the use of FormData", async () => {
    //   const form = new FormData();
    //   form.append("foo", "bar");
    //   const { body } = await request(`${hostUrl}/post`, {
    //     method: "POST",
    //     body: form,
    //   });

    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { form: { foo: string } };
    //   expect(json.form.foo).toBe("bar");
    // });
  });

  describe("dispatcher TLS options", () => {
    it("Agent should store connect options", () => {
      const { Agent } = require("undici");
      const agent = new Agent({
        connect: {
          rejectUnauthorized: false,
          ca: "test-ca",
        },
      });

      expect(agent.options).toBeDefined();
      expect(agent.connect).toBeDefined();
      expect(agent.connect.rejectUnauthorized).toBe(false);
      expect(agent.connect.ca).toBe("test-ca");
    });

    it("Dispatcher should store connect options", () => {
      const { Dispatcher } = require("undici");
      const dispatcher = new Dispatcher({
        connect: {
          rejectUnauthorized: false,
        },
      });

      expect(dispatcher.options).toBeDefined();
      expect(dispatcher.connect).toBeDefined();
      expect(dispatcher.connect.rejectUnauthorized).toBe(false);
    });

    it("Pool should store connect options", () => {
      const { Pool } = require("undici");
      const pool = new Pool("http://localhost", {
        connect: {
          rejectUnauthorized: false,
        },
      });

      expect(pool.options).toBeDefined();
      expect(pool.connect).toBeDefined();
      expect(pool.connect.rejectUnauthorized).toBe(false);
    });

    it("BalancedPool should store connect options", () => {
      const { BalancedPool } = require("undici");
      const balancedPool = new BalancedPool(["http://localhost"], {
        connect: {
          rejectUnauthorized: false,
        },
      });

      expect(balancedPool.options).toBeDefined();
      expect(balancedPool.connect).toBeDefined();
      expect(balancedPool.connect.rejectUnauthorized).toBe(false);
    });

    it("Client should store connect options", () => {
      const { Client } = require("undici");
      const client = new Client("http://localhost", {
        connect: {
          rejectUnauthorized: false,
        },
      });

      expect(client.options).toBeDefined();
      expect(client.connect).toBeDefined();
      expect(client.connect.rejectUnauthorized).toBe(false);
    });

    it("ProxyAgent should store connect options", () => {
      const { ProxyAgent } = require("undici");
      const proxyAgent = new ProxyAgent({
        connect: {
          rejectUnauthorized: false,
        },
      });

      expect(proxyAgent.options).toBeDefined();
      expect(proxyAgent.connect).toBeDefined();
      expect(proxyAgent.connect.rejectUnauthorized).toBe(false);
    });

    it("EnvHttpProxyAgent should store connect options", () => {
      const { EnvHttpProxyAgent } = require("undici");
      const envAgent = new EnvHttpProxyAgent({
        connect: {
          rejectUnauthorized: false,
        },
      });

      expect(envAgent.options).toBeDefined();
      expect(envAgent.connect).toBeDefined();
      expect(envAgent.connect.rejectUnauthorized).toBe(false);
    });

    it("RetryAgent should store connect options", () => {
      const { RetryAgent, Dispatcher } = require("undici");
      const baseDispatcher = new Dispatcher();
      const retryAgent = new RetryAgent(baseDispatcher, {
        connect: {
          rejectUnauthorized: false,
        },
      });

      expect(retryAgent.options).toBeDefined();
      expect(retryAgent.connect).toBeDefined();
      expect(retryAgent.connect.rejectUnauthorized).toBe(false);
    });

    it("Agent without options should have undefined connect", () => {
      const { Agent } = require("undici");
      const agent = new Agent();

      expect(agent.options).toBeUndefined();
      expect(agent.connect).toBeUndefined();
    });

    it("Agent with options but no connect should not have connect", () => {
      const { Agent } = require("undici");
      const agent = new Agent({ someOtherOption: true });

      expect(agent.options).toBeDefined();
      expect(agent.connect).toBeUndefined();
    });
  });
});
