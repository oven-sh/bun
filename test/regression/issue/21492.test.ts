import { expect, test } from "bun:test";

test("undici.Agent connect option should be used with fetch (original issue)", async () => {
  const { Agent } = require("undici");

  let connectCalled = false;
  let connectionOptions: any = null;

  const dispatcher = new Agent({
    connect: (o: any, cb: any) => {
      connectCalled = true;
      connectionOptions = o;
      throw new Error("Custom connect error (expected)");
    },
  });

  let errorThrown = false;
  try {
    await fetch("https://icanhazip.com", { dispatcher } as any);
  } catch (error) {
    errorThrown = true;
    expect((error as Error).message).toContain("Custom connect error");
  }
  expect(errorThrown).toBe(true);
  expect(connectCalled).toBe(true);
  expect(connectionOptions).toBeDefined();
  expect(connectionOptions.hostname).toBe("icanhazip.com");
  expect(connectionOptions.port).toBe(443);
});

test("undici.Agent connect option should be used with dispatch", async () => {
  const { Agent } = require("undici");

  let connectCalled = false;
  let connectionOptions: any = null;

  const agent = new Agent({
    connect: (options: any, callback: any) => {
      connectCalled = true;
      connectionOptions = options;
      callback(new Error("Custom connect error (expected)"));
    },
  });

  let errorThrown = false;
  try {
    await agent.dispatch({
      origin: "https://icanhazip.com",
      path: "/",
      method: "GET",
    });
  } catch (error) {
    errorThrown = true;
    expect((error as Error).message).toContain("Custom connect error");
  }
  expect(errorThrown).toBe(true);
  expect(connectCalled).toBe(true);
  expect(connectionOptions).toBeDefined();
  expect(connectionOptions.hostname).toBe("icanhazip.com");
  expect(connectionOptions.port).toBe(443);
});

test("fetch-socks pattern compatibility", async () => {
  const { Agent } = require("undici");

  let socksConnectCalled = false;
  let socksHostname: string | undefined;

  const socksAgent = new Agent({
    connect: (options: any, callback: any) => {
      socksConnectCalled = true;
      socksHostname = options.hostname;
      callback(new Error("SOCKS connection blocked (expected)"));
    },
  });

  let socksErrorThrown = false;
  try {
    await socksAgent.dispatch({
      origin: "https://example.com",
      path: "/test",
      method: "GET",
    });
  } catch (error) {
    socksErrorThrown = true;
    expect((error as Error).message).toContain("SOCKS connection blocked");
  }
  expect(socksErrorThrown).toBe(true);
  expect(socksConnectCalled).toBe(true);
  expect(socksHostname).toBe("example.com");
});

test("normal Agent without connect should work", async () => {
  const { Agent } = require("undici");

  const normalAgent = new Agent({
    keepAliveTimeout: 1000,
    connections: 10,
  });

  try {
    const response = await normalAgent.dispatch({
      origin: "https://httpbin.org",
      path: "/get",
      method: "GET",
    });
    expect(response).toBeDefined();
    expect(response.statusCode).toBeDefined();
  } catch (error) {
    expect((error as Error).message).not.toContain("dispatcher");
  }
});

test("direct undici.request function should work", async () => {
  const { request } = require("undici");

  try {
    const response = await request("https://httpbin.org/get", {
      method: "GET",
    });
    expect(response).toBeDefined();
    expect(response.statusCode).toBeDefined();
  } catch (error) {
    expect(error).toBeDefined();
  }
});
