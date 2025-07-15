import { expect, test } from "bun:test";
import { bunExe, bunEnv } from "harness";

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

  const [bunStdout, bunExitCode] = await Promise.all([
    new Response(bunProc.stdout).text(),
    bunProc.exited,
  ]);

  expect(bunExitCode).toBe(0);
  const bunResult = JSON.parse(bunStdout.trim());
  
  // The bug: Bun follows the redirect even though redirect: "manual" was specified
  // Expected: status=302, url=original, redirected=false
  // Actual (bug): status=200, url=target, redirected=true
  expect(bunResult).toEqual({
    status: 302,
    url: `${server.url}/redirect`,
    redirected: false,
    location: "/target"
  });
});

// Additional test to verify it works with external redirects
test("fetch with Request object respects redirect: 'manual' for external URLs", async () => {
  // This test uses a real URL that redirects
  const request = new Request("https://w3id.org/security/v1", {
    redirect: "manual",
  });
  
  const response = await fetch(request);
  
  // When redirect: "manual" is set, we should get the redirect response
  expect([301, 302, 303, 307, 308]).toContain(response.status); // Any redirect status
  expect(response.url).toBe("https://w3id.org/security/v1");
  expect(response.redirected).toBe(false);
  expect(response.headers.get("location")).toBeTruthy();
});