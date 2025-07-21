import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("fetch with Request object respects redirect: 'manual' option", async () => {
  // Test server that redirects
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/target",
          },
        });
      }
      if (url.pathname === "/target") {
        return new Response("Target reached", { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  // Test 1: Direct fetch with redirect: "manual" (currently works)
  const directResponse = await fetch(`${server.url}/redirect`, {
    redirect: "manual",
  });
  expect(directResponse.status).toBe(302);
  expect(directResponse.url).toBe(`${server.url}/redirect`);
  expect(directResponse.headers.get("location")).toBe("/target");
  expect(directResponse.redirected).toBe(false);

  // Test 2: Fetch with Request object and redirect: "manual" (currently broken)
  const request = new Request(`${server.url}/redirect`, {
    redirect: "manual",
  });
  const requestResponse = await fetch(request);
  expect(requestResponse.status).toBe(302);
  expect(requestResponse.url).toBe(`${server.url}/redirect`); // This should be the original URL, not the target
  expect(requestResponse.headers.get("location")).toBe("/target");
  expect(requestResponse.redirected).toBe(false);

  // Test 3: Verify the behavior matches Node.js and Deno
  const testScript = `
    async function main() {
      const request = new Request("${server.url}/redirect", {
        redirect: "manual",
      });
      const response = await fetch(request);
      console.log(JSON.stringify({
        status: response.status,
        url: response.url,
        redirected: response.redirected,
        location: response.headers.get("location")
      }));
    }
    main();
  `;

  // Run with Bun
  await using bunProc = Bun.spawn({
    cmd: [bunExe(), "-e", testScript],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [bunStdout, bunExitCode] = await Promise.all([new Response(bunProc.stdout).text(), bunProc.exited]);

  expect(bunExitCode).toBe(0);
  const bunResult = JSON.parse(bunStdout.trim());

  // The bug: Bun follows the redirect even though redirect: "manual" was specified
  // Expected: status=302, url=original, redirected=false
  // Actual (bug): status=200, url=target, redirected=true
  expect(bunResult).toEqual({
    status: 302,
    url: `${server.url}/redirect`,
    redirected: false,
    location: "/target",
  });
});

// Additional test to verify it works with external redirects
test("fetch with Request object respects redirect: 'manual' for external URLs", async () => {
  // This test uses a real URL that redirects
  using server = Bun.serve({
    port: 0,
    routes: {
      "/redirect": new Response(null, {
        status: 302,
        headers: {
          Location: "/target",
        },
      }),
      "/target": new Response("Target reached", { status: 200 }),
    },
  });

  const request = new Request(`${server.url}/redirect`, {
    redirect: "manual",
  });

  const response = await fetch(request);

  // When redirect: "manual" is set, we should get the redirect response
  expect(response.status).toBe(302);
  expect(response.url).toBe(`${server.url}/redirect`);
  expect(response.redirected).toBe(false);
  expect(response.headers.get("location")).toBe("/target");
});

// Test edge case: fetch with options but no redirect should use Request's redirect
test("fetch with Request respects redirect when fetch has other options but no redirect", async () => {
  // Test server that redirects
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/target",
          },
        });
      }
      if (url.pathname === "/target") {
        return new Response("Target reached", {
          status: 200,
          headers: {
            "X-Target": "true",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  // Create a Request with redirect: "manual"
  const request = new Request(`${server.url}/redirect`, {
    redirect: "manual",
    headers: {
      "X-Original": "request",
    },
  });

  // Test 1: fetch with other options but NO redirect option
  // Should use the Request's redirect: "manual"
  const response1 = await fetch(request, {
    headers: {
      "X-Additional": "fetch-option",
    },
    // Note: no redirect option here
  });

  expect(response1.status).toBe(302);
  expect(response1.url).toBe(`${server.url}/redirect`);
  expect(response1.redirected).toBe(false);
  expect(response1.headers.get("location")).toBe("/target");

  // Test 2: fetch with explicit redirect option should override Request's redirect
  const response2 = await fetch(request, {
    headers: {
      "X-Additional": "fetch-option",
    },
    redirect: "follow", // Explicitly override
  });

  expect(response2.status).toBe(200);
  expect(response2.url).toBe(new URL("/target", server.url).href);
  expect(response2.redirected).toBe(true);
  expect(response2.headers.get("X-Target")).toBe("true");

  // Test 3: fetch with empty options object should use Request's redirect
  const response3 = await fetch(request, {});

  expect(response3.status).toBe(302);
  expect(response3.url).toBe(`${server.url}/redirect`);
  expect(response3.redirected).toBe(false);
});
