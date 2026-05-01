import { expect, test } from "bun:test";

test("issue #21677 - should not add redundant Date headers", async () => {
  const testDate1 = new Date("2025-08-07T17:01:47.000Z").toUTCString();
  const testDate2 = new Date("2025-08-07T17:02:23.000Z").toUTCString();
  const testDate3 = new Date("2025-08-07T17:03:06.000Z").toUTCString();

  using server = Bun.serve({
    port: 0,
    routes: {
      "/static": () =>
        new Response(`date test`, {
          headers: { date: testDate1 },
        }),
      "/proxy": async () => {
        // Create a simple server response with a Date header to proxy
        const simpleResponse = new Response("proxied content", {
          headers: {
            "Date": testDate3,
            "Content-Type": "text/plain",
          },
        });
        return simpleResponse;
      },
    },
    fetch: () =>
      new Response(`date test`, {
        headers: { date: testDate2 },
      }),
  });

  // Test dynamic route (default fetch handler)
  {
    const response = await fetch(server.url);

    // Should only have one Date header, not multiple
    const dateHeaders = [...response.headers.entries()].filter(([key]) => key.toLowerCase() === "date");
    expect(dateHeaders).toHaveLength(1);
    expect(dateHeaders[0][1]).toBe(testDate2);
  }

  // Test static route
  {
    const response = await fetch(new URL("/static", server.url));

    // Should only have one Date header, not multiple
    const dateHeaders = [...response.headers.entries()].filter(([key]) => key.toLowerCase() === "date");
    expect(dateHeaders).toHaveLength(1);
    expect(dateHeaders[0][1]).toBe(testDate1);
  }

  // Test proxy route
  {
    const response = await fetch(new URL("/proxy", server.url));

    // Should only have one Date header, not multiple
    const dateHeaders = [...response.headers.entries()].filter(([key]) => key.toLowerCase() === "date");
    expect(dateHeaders).toHaveLength(1);
    expect(dateHeaders[0][1]).toBe(testDate3);
  }
});

test("issue #21677 - reproduce with raw HTTP to verify duplicate headers", async () => {
  const testDate = new Date("2025-08-07T17:02:23.000Z").toUTCString();

  using server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(`date test`, {
        headers: { date: testDate },
      }),
  });

  // Use TCP socket to get raw HTTP response and check for duplicate headers
  await new Promise((resolve, reject) => {
    const socket = Bun.connect({
      hostname: "localhost",
      port: server.port,
      socket: {
        data(socket, data) {
          const response = data.toString();
          // Should NOT contain multiple Date headers
          const lines = response.split("\r\n");
          const dateHeaderLines = lines.filter(line => line.toLowerCase().startsWith("date:"));

          expect(dateHeaderLines).toHaveLength(1);
          expect(dateHeaderLines[0]).toBe(`Date: ${testDate}`);
          socket.end();
          resolve(undefined);
        },
        error(socket, error) {
          reject(error);
        },
        open(socket) {
          socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        },
      },
    });
  });
});
