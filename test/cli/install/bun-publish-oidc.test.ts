import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv, stderrForInstall, tempDir } from "harness";

// Fake HOME without any .npmrc so global npm credentials
// don't interfere with the registry URL and auth in our tests.
using fakeHome = tempDir("oidc-home", {});

async function publish(
  customEnv: Record<string, string>,
  cwd: string,
  ...args: string[]
): Promise<{ out: string; err: string; exitCode: number }> {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "publish", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: customEnv,
  });

  const out = await stdout.text();
  const err = stderrForInstall(await stderr.text());
  const exitCode = await exited;
  return { out, err, exitCode };
}

// Build a clean env from bunEnv with OIDC-related vars stripped,
// then apply overrides. Ensures no stale vars leak between tests.
function buildEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(bunEnv)) {
    if (v != null) result[k] = v;
  }
  // Strip OIDC-related vars and npm auth vars to prevent
  // global ~/.npmrc credentials from leaking into tests
  for (const key of [
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "NPM_ID_TOKEN",
    "NODE_AUTH_TOKEN",
    "NPM_TOKEN",
    "NPM_CONFIG_TOKEN",
    "BUN_CONFIG_TOKEN",
  ]) {
    delete result[key];
  }
  // Use a fake HOME to avoid reading global ~/.npmrc credentials.
  // Set both HOME (Unix) and USERPROFILE (Windows) for cross-platform isolation.
  result.HOME = String(fakeHome);
  result.USERPROFILE = String(fakeHome);
  return { ...result, ...overrides };
}

describe("oidc trusted publishing", () => {
  test("successful OIDC auth via GitHub Actions", async () => {
    const oidcToken = "mock-oidc-identity-token";
    const npmToken = "mock-npm-short-lived-token";

    // Mock GitHub Actions OIDC endpoint
    using oidcServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        // Verify audience parameter
        expect(url.searchParams.get("audience")).toStartWith("npm:");
        // Verify bearer token
        expect(req.headers.get("authorization")).toBe("Bearer mock-request-token");
        return Response.json({ value: oidcToken });
      },
    });

    // Mock npm registry that handles the OIDC token exchange. Under --dry-run,
    // publish never issues the PUT, so we only need the exchange endpoint here.
    // PUT-path coverage is in the non-dry-run test below.
    using registryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname.includes("/-/npm/v1/oidc/token/exchange/package/")) {
          expect(req.method).toBe("POST");
          expect(req.headers.get("authorization")).toBe(`Bearer ${oidcToken}`);
          return Response.json({ token: npmToken });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    using dir = tempDir("oidc-publish-test", {
      "package.json": JSON.stringify({
        name: "oidc-test-pkg",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}/" }`,
    });

    const { err, exitCode } = await publish(
      buildEnv({
        CI: "true",
        GITHUB_ACTIONS: "true",
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token?`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "mock-request-token",
      }),
      String(dir),
      "--dry-run",
    );

    // dry-run succeeds (exits 0) which means auth passed
    expect(err).not.toContain("missing authentication");
    expect(exitCode).toBe(0);
  });

  test("falls back to NeedAuth when OIDC is not available", async () => {
    using registryServer = Bun.serve({
      port: 0,
      async fetch() {
        return new Response("Not Found", { status: 404 });
      },
    });

    using dir = tempDir("oidc-publish-noauth", {
      "package.json": JSON.stringify({
        name: "oidc-test-noauth",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}/" }`,
    });

    // No OIDC vars, CI disabled — should fail with NeedAuth
    const { err, exitCode } = await publish(
      buildEnv({ CI: "false", GITHUB_ACTIONS: "false" }),
      String(dir),
      "--dry-run",
    );

    expect(err).toContain("missing authentication");
    expect(exitCode).toBe(1);
  });

  test("falls back to NeedAuth when OIDC exchange fails", async () => {
    // Mock OIDC endpoint that returns a token
    using oidcServer = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({ value: "mock-oidc-token" });
      },
    });

    // Mock registry that rejects the token exchange
    using registryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/-/npm/v1/oidc/token/exchange/package/")) {
          return new Response("Forbidden", { status: 403 });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    using dir = tempDir("oidc-publish-fail", {
      "package.json": JSON.stringify({
        name: "oidc-test-fail",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}/" }`,
    });

    // OIDC is available but exchange returns 403 — should fall through to NeedAuth
    const { err, exitCode } = await publish(
      buildEnv({
        CI: "true",
        GITHUB_ACTIONS: "true",
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token?`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "mock-request-token",
      }),
      String(dir),
      "--dry-run",
    );

    expect(err).toContain("missing authentication");
    expect(exitCode).toBe(1);
  });

  test("uses NPM_ID_TOKEN env var directly", async () => {
    const oidcToken = "npm-id-token-direct";
    const npmToken = "mock-npm-token-from-id";

    // Mock registry for token exchange only; dry-run never reaches PUT.
    using registryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname.includes("/-/npm/v1/oidc/token/exchange/package/")) {
          expect(req.method).toBe("POST");
          expect(req.headers.get("authorization")).toBe(`Bearer ${oidcToken}`);
          return Response.json({ token: npmToken });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    using dir = tempDir("oidc-publish-npmid", {
      "package.json": JSON.stringify({
        name: "oidc-test-npmid",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}/" }`,
    });

    // NPM_ID_TOKEN bypasses GitHub Actions flow
    const { err, exitCode } = await publish(
      buildEnv({
        CI: "true",
        GITHUB_ACTIONS: "false",
        NPM_ID_TOKEN: oidcToken,
      }),
      String(dir),
      "--dry-run",
    );

    expect(err).not.toContain("missing authentication");
    expect(exitCode).toBe(0);
  });

  test("skips OIDC when explicit token is configured", async () => {
    const explicitToken = "explicit-auth-token";
    let oidcExchangeCalled = false;

    // Separate OIDC server that returns a valid identity token.
    // If the OIDC gate is broken, the exchange endpoint on the registry
    // would be hit and flip oidcExchangeCalled to true, failing the test.
    using oidcServer = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({ value: "oidc-token-should-not-be-used" });
      },
    });

    // Mock registry. OIDC exchange must not be called when an explicit token
    // is set. Dry-run never reaches PUT, so no PUT handler is needed.
    using registryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname.includes("/-/npm/v1/oidc/token/exchange/package/")) {
          oidcExchangeCalled = true;
          return Response.json({ token: "should-not-be-used" });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    using dir = tempDir("oidc-publish-explicit", {
      "package.json": JSON.stringify({
        name: "oidc-test-explicit",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}/", token = "${explicitToken}" }`,
    });

    // Even with OIDC env vars set, explicit token in bunfig should take precedence
    const { err, exitCode } = await publish(
      buildEnv({
        CI: "true",
        GITHUB_ACTIONS: "true",
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token?`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "mock-request-token",
      }),
      String(dir),
      "--dry-run",
    );

    expect(err).not.toContain("missing authentication");
    expect(oidcExchangeCalled).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("OIDC token is injected into publish PUT request (non-dry-run)", async () => {
    // End-to-end: runs the real publish PUT so we can assert the OIDC-exchanged
    // token actually flows through constructPublishHeaders into the PUT's
    // Authorization header. The dry-run tests above only exercise the OIDC
    // POST exchange — they return before any PUT is made.
    const oidcToken = "e2e-oidc-identity-token";
    const npmToken = "e2e-exchanged-npm-token";

    using oidcServer = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({ value: oidcToken });
      },
    });

    const { promise: putReceived, resolve: resolvePut } =
      Promise.withResolvers<{ authorization: string | null }>();

    using registryServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname.includes("/-/npm/v1/oidc/token/exchange/package/")) {
          expect(req.method).toBe("POST");
          expect(req.headers.get("authorization")).toBe(`Bearer ${oidcToken}`);
          return Response.json({ token: npmToken });
        }

        if (req.method === "PUT") {
          resolvePut({ authorization: req.headers.get("authorization") });
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    using dir = tempDir("oidc-publish-e2e", {
      "package.json": JSON.stringify({
        name: "oidc-e2e-pkg",
        version: "1.0.0",
      }),
      "bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}/" }`,
    });

    const { err, exitCode } = await publish(
      buildEnv({
        CI: "true",
        GITHUB_ACTIONS: "true",
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token?`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "mock-request-token",
      }),
      String(dir),
    );

    const put = await putReceived;
    expect(put.authorization).toBe(`Bearer ${npmToken}`);
    expect(err).not.toContain("missing authentication");
    expect(exitCode).toBe(0);
  });
});
