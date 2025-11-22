import { expect, test } from "bun:test";
import * as diagnostics_channel from "node:diagnostics_channel";
import * as http from "node:http";

test("http.client diagnostics_channel events are emitted", async () => {
  const events: string[] = [];
  const requestData: any[] = [];

  // Subscribe to all HTTP client diagnostics channels
  const createdChannel = diagnostics_channel.channel("http.client.request.created");
  const startChannel = diagnostics_channel.channel("http.client.request.start");
  const errorChannel = diagnostics_channel.channel("http.client.request.error");
  const finishChannel = diagnostics_channel.channel("http.client.response.finish");

  createdChannel.subscribe(({ request }) => {
    events.push("created");
    requestData.push({ event: "created", hasRequest: !!request });
  });

  startChannel.subscribe(({ request }) => {
    events.push("start");
    requestData.push({ event: "start", hasRequest: !!request });
  });

  errorChannel.subscribe(({ request, error }) => {
    events.push("error");
    requestData.push({ event: "error", hasRequest: !!request, hasError: !!error });
  });

  finishChannel.subscribe(({ request, response }) => {
    events.push("finish");
    requestData.push({ event: "finish", hasRequest: !!request, hasResponse: !!response });
  });

  // Create a simple HTTP server
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }

  // Make an HTTP request
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: address.port,
        path: "/",
        method: "GET",
      },
      res => {
        let data = "";
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe("Hello World");
          resolve();
        });
      },
    );

    req.on("error", reject);
    req.end();
  });

  // Close the server
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });

  // Verify events were emitted in the correct order
  expect(events).toEqual(["created", "start", "finish"]);

  // Verify each event had the required data
  expect(requestData[0]).toEqual({ event: "created", hasRequest: true });
  expect(requestData[1]).toEqual({ event: "start", hasRequest: true });
  expect(requestData[2]).toEqual({ event: "finish", hasRequest: true, hasResponse: true });
});

test("http.client.request.error diagnostics_channel event is emitted on error", async () => {
  const events: string[] = [];
  const errorData: any[] = [];

  const createdChannel = diagnostics_channel.channel("http.client.request.created");
  const startChannel = diagnostics_channel.channel("http.client.request.start");
  const errorChannel = diagnostics_channel.channel("http.client.request.error");
  const finishChannel = diagnostics_channel.channel("http.client.response.finish");

  createdChannel.subscribe(() => events.push("created"));
  startChannel.subscribe(() => events.push("start"));
  errorChannel.subscribe(({ request, error }) => {
    events.push("error");
    errorData.push({ hasRequest: !!request, hasError: !!error, errorMessage: error?.message });
  });
  finishChannel.subscribe(() => events.push("finish"));

  // Make a request to a non-existent server
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 1, // Port 1 should refuse connection
        path: "/",
        method: "GET",
      },
      () => {
        reject(new Error("Should not receive response"));
      },
    );

    req.on("error", err => {
      // Error is expected
      expect(err).toBeDefined();
      resolve();
    });

    req.end();
  });

  // Verify created and start events were emitted, followed by error
  expect(events).toContain("created");
  expect(events).toContain("start");
  expect(events).toContain("error");

  // Verify finish was not emitted (since request errored)
  expect(events).not.toContain("finish");

  // Verify error event had the required data
  expect(errorData.length).toBeGreaterThan(0);
  expect(errorData[0].hasRequest).toBe(true);
  expect(errorData[0].hasError).toBe(true);
});

test("http.get also emits diagnostics_channel events", async () => {
  const events: string[] = [];

  const createdChannel = diagnostics_channel.channel("http.client.request.created");
  const startChannel = diagnostics_channel.channel("http.client.request.start");
  const finishChannel = diagnostics_channel.channel("http.client.response.finish");

  createdChannel.subscribe(() => events.push("created"));
  startChannel.subscribe(() => events.push("start"));
  finishChannel.subscribe(() => events.push("finish"));

  // Create a simple HTTP server
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }

  // Make an HTTP GET request
  await new Promise<void>((resolve, reject) => {
    http.get(`http://localhost:${address.port}/`, res => {
      res.on("data", () => {});
      res.on("end", () => resolve());
      res.on("error", reject);
    });
  });

  // Close the server
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });

  // Verify events were emitted
  expect(events).toEqual(["created", "start", "finish"]);
});

test("diagnostics_channel events work with POST requests with body", async () => {
  const events: string[] = [];

  const createdChannel = diagnostics_channel.channel("http.client.request.created");
  const startChannel = diagnostics_channel.channel("http.client.request.start");
  const finishChannel = diagnostics_channel.channel("http.client.response.finish");

  createdChannel.subscribe(() => events.push("created"));
  startChannel.subscribe(() => events.push("start"));
  finishChannel.subscribe(() => events.push("finish"));

  // Create a simple HTTP server
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`Received: ${body}`);
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }

  // Make an HTTP POST request with body
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: address.port,
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
      res => {
        let data = "";
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          expect(data).toBe('Received: {"test":"data"}');
          resolve();
        });
      },
    );

    req.on("error", reject);
    req.write('{"test":"data"}');
    req.end();
  });

  // Close the server
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });

  // Verify events were emitted
  expect(events).toEqual(["created", "start", "finish"]);
});
