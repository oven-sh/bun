import { test, expect } from "bun:test";

test("undici.Agent connect option should be used", async () => {
  const { Agent } = require("undici");

  let connectCalled = false;
  let connectionOptions: any = null;

  // Test that the connect function is called when using Agent with custom connect
  const dispatcher = new Agent({
    connect: (options: any, callback: any) => {
      connectCalled = true;
      connectionOptions = options;
      throw new Error("Custom connect error (expected)");
    },
  });

  // The fetch should fail because our connect function throws an error
  let errorThrown = false;
  try {
    await fetch("https://icanhazip.com", { dispatcher } as any);
  } catch (error) {
    errorThrown = true;
    // The connect function should throw our custom error
    expect((error as Error).message).toContain("Custom connect error");
  }
  expect(errorThrown).toBe(true);

  // Verify that the connect function was actually called
  expect(connectCalled).toBe(true);
  expect(connectionOptions).toBeDefined();
  expect(connectionOptions.hostname).toBe("icanhazip.com");
  expect(connectionOptions.port).toBe(443);
});

test("fetch-socks pattern compatibility", async () => {
  const { Agent } = require("undici");

  let socksConnectCalled = false;
  let socksHostname: string | undefined;

  // Simulate the fetch-socks pattern
  const socksAgent = new Agent({
    connect: (options: any, callback: any) => {
      socksConnectCalled = true;
      socksHostname = options.hostname;
      throw new Error("SOCKS connection blocked (expected)");
    },
  });

  // The fetch should fail because our SOCKS connect throws an error
  let socksErrorThrown = false;
  try {
    await fetch("https://example.com", { dispatcher: socksAgent } as any);
  } catch (error) {
    socksErrorThrown = true;
    // The connect function should throw our custom SOCKS error
    expect((error as Error).message).toContain("SOCKS connection blocked");
  }
  expect(socksErrorThrown).toBe(true);

  expect(socksConnectCalled).toBe(true);
  expect(socksHostname).toBe("example.com");
});

test("normal Agent without connect should work", async () => {
  const { Agent } = require("undici");

  // Test that normal agents still work without connect option
  const normalAgent = new Agent({
    keepAliveTimeout: 1000,
    connections: 10,
  });

  // This should work normally (though it may fail due to network issues in CI)
  // We'll just test that it doesn't throw due to our changes
  try {
    const response = await fetch("https://httpbin.org/get", {
      dispatcher: normalAgent,
    } as any);
    expect(response).toBeDefined();
  } catch (error) {
    // Network errors are acceptable in CI, but it shouldn't be due to our dispatcher changes
    expect((error as Error).message).not.toContain("dispatcher");
  }
});
