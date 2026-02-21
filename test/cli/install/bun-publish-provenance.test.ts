import { spawn, write } from "bun";
import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv as env, stderrForInstall, tmpdirSync } from "harness";
import { join } from "node:path";

/**
 * Helper to run `bun publish` with custom env + args.
 */
async function publish(
  customEnv: Record<string, string | undefined>,
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

/**
 * Create a minimal package directory for provenance testing.
 */
function createPackageDir(opts: { name: string; version: string; registryUrl?: string; token?: string }) {
  const dir = tmpdirSync();
  const pkgJson = JSON.stringify({
    name: opts.name,
    version: opts.version,
  });

  const bunfig = opts.registryUrl
    ? `[install]\ncache = false\nregistry = { url = "${opts.registryUrl}", token = "${opts.token ?? "test-token"}" }`
    : `[install]\ncache = false`;

  return { dir, pkgJson, bunfig };
}

// ============================================================================
// Section 1 & 2: CLI Flag Parsing & CI Environment Detection
// ============================================================================

describe("--provenance", () => {
  describe("CI environment detection errors", () => {
    test("errors outside CI with clear message", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-1",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      // bunEnv sets GITHUB_ACTIONS=false, so CI detection should fail
      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: undefined,
          CI: undefined,
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("provenance generation requires a supported CI environment");
      expect(exitCode).not.toBe(0);
    });

    test("errors with GITHUB_ACTIONS=true but missing OIDC endpoint", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-2",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("permissions: id-token: write");
      expect(exitCode).not.toBe(0);
    });

    test("errors with GITHUB_ACTIONS=true + OIDC URL but missing token", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-3",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: "http://localhost:1234/token",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("OIDC");
      expect(exitCode).not.toBe(0);
    });

    test("errors with GITLAB_CI=true but missing SIGSTORE_ID_TOKEN", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-4",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: "true",
          SIGSTORE_ID_TOKEN: undefined,
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("OIDC");
      expect(exitCode).not.toBe(0);
    });

    test("errors with unsupported CI provider", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-5",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      // Set CI=true but with a provider that doesn't support provenance
      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: undefined,
          BUILDKITE: "true",
          CI: "true",
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("only supported in GitHub Actions and GitLab CI");
      expect(exitCode).not.toBe(0);
    });

    test("--dry-run + --provenance outside CI still errors", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-6",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      // CI check happens before dry-run skip, so this should still error
      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: undefined,
          CI: undefined,
        },
        dir,
        "--provenance",
        "--dry-run",
      );

      expect(err).toContain("provenance generation requires a supported CI environment");
      expect(exitCode).not.toBe(0);
    });

    test("GitHub Actions with missing required env vars errors", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-7",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      // Mock OIDC server that returns a valid token
      using oidcServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            JSON.stringify({
              value:
                "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXN1YmplY3QiLCJpc3MiOiJodHRwczovL3Rva2VuLmFjdGlvbnMuZ2l0aHVidXNlcmNvbnRlbnQuY29tIiwiYXVkIjoic2lnc3RvcmUiLCJleHAiOjk5OTk5OTk5OTl9.fake-signature",
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
      });

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-bearer-token",
          // Missing required GitHub env vars
          GITHUB_WORKFLOW_REF: undefined,
          GITHUB_REPOSITORY: undefined,
          GITHUB_EVENT_NAME: undefined,
          GITHUB_REPOSITORY_ID: undefined,
          GITHUB_REPOSITORY_OWNER_ID: undefined,
          GITHUB_REF: undefined,
          GITHUB_SHA: undefined,
          GITHUB_RUN_ID: undefined,
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("missing required GitHub Actions environment variables");
      expect(exitCode).not.toBe(0);
    });

    test("without --provenance flag does not attempt provenance", async () => {
      // This test verifies that the --provenance flag is actually needed
      // Publish without --provenance should not check CI environment
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-test-noflag",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: undefined,
          CI: undefined,
        },
        dir,
        "--dry-run",
      );

      // Without --provenance, there should be no provenance-related error
      expect(err).not.toContain("provenance");
      expect(exitCode).toBe(0);
    });
  });

  // ============================================================================
  // Section 3 & 13: OIDC Token Acquisition & Integration Tests
  // ============================================================================

  describe("GitHub Actions OIDC token acquisition", () => {
    test("fetches OIDC token with correct audience parameter", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-oidc-1",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      let receivedUrl = "";
      let receivedAuthHeader = "";

      using oidcServer = Bun.serve({
        port: 0,
        fetch(req) {
          receivedUrl = req.url;
          receivedAuthHeader = req.headers.get("authorization") ?? "";

          return new Response(
            JSON.stringify({
              value:
                "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXN1YmplY3QiLCJpc3MiOiJodHRwczovL3Rva2VuLmFjdGlvbnMuZ2l0aHVidXNlcmNvbnRlbnQuY29tIiwiYXVkIjoic2lnc3RvcmUiLCJleHAiOjk5OTk5OTk5OTl9.fake-signature",
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
      });

      // This will fail at Fulcio step (since we don't mock it), but we can verify the OIDC request
      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "my-secret-token",
          GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/publish.yml@refs/heads/main",
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_EVENT_NAME: "push",
          GITHUB_REPOSITORY_ID: "12345",
          GITHUB_REPOSITORY_OWNER_ID: "67890",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: "abc123def456",
          RUNNER_ENVIRONMENT: "github-hosted",
          GITHUB_RUN_ID: "9999",
          GITHUB_RUN_ATTEMPT: "1",
        },
        dir,
        "--provenance",
      );

      // Verify OIDC request was made with correct params
      expect(receivedUrl).toContain("audience=sigstore");
      expect(receivedAuthHeader).toBe("Bearer my-secret-token");

      // It will fail at Fulcio since we don't mock it, but the OIDC step should succeed
      // The error should be about Fulcio, not about OIDC
      expect(err).not.toContain("OIDC");
    });

    test("handles OIDC server returning non-200 status", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-oidc-fail",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      using oidcServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Unauthorized", { status: 401 });
        },
      });

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "bad-token",
          GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/publish.yml@refs/heads/main",
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_EVENT_NAME: "push",
          GITHUB_REPOSITORY_ID: "12345",
          GITHUB_REPOSITORY_OWNER_ID: "67890",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: "abc123",
          GITHUB_RUN_ID: "1",
          GITHUB_RUN_ATTEMPT: "1",
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("OIDC");
      expect(exitCode).not.toBe(0);
    });

    test("handles OIDC server returning invalid JSON", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-oidc-badjson",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      using oidcServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response("not json at all", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        },
      });

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
          GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/publish.yml@refs/heads/main",
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_EVENT_NAME: "push",
          GITHUB_REPOSITORY_ID: "12345",
          GITHUB_REPOSITORY_OWNER_ID: "67890",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: "abc123",
          GITHUB_RUN_ID: "1",
          GITHUB_RUN_ATTEMPT: "1",
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("OIDC");
      expect(exitCode).not.toBe(0);
    });

    test("handles OIDC response missing value field", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-oidc-novalue",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      using oidcServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response(JSON.stringify({ token: "wrong-field-name" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
          GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/publish.yml@refs/heads/main",
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_EVENT_NAME: "push",
          GITHUB_REPOSITORY_ID: "12345",
          GITHUB_REPOSITORY_OWNER_ID: "67890",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: "abc123",
          GITHUB_RUN_ID: "1",
          GITHUB_RUN_ATTEMPT: "1",
        },
        dir,
        "--provenance",
      );

      expect(err).toContain("OIDC");
      expect(exitCode).not.toBe(0);
    });
  });

  // ============================================================================
  // Sections 5-10, 13: Full Integration Test with Mock Sigstore Services
  // ============================================================================

  describe("full provenance flow with mock services", () => {
    // A minimal valid JWT for testing (header.payload.signature)
    // The payload contains: { "sub": "test-subject", "iss": "https://token.actions.githubusercontent.com", "aud": "sigstore" }
    const MOCK_JWT =
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXN1YmplY3QiLCJpc3MiOiJodHRwczovL3Rva2VuLmFjdGlvbnMuZ2l0aHVidXNlcmNvbnRlbnQuY29tIiwiYXVkIjoic2lnc3RvcmUiLCJleHAiOjk5OTk5OTk5OTl9.fake-signature";

    // A self-signed test certificate (not a real cert, just PEM structure for testing)
    const MOCK_PEM_CERT =
      "-----BEGIN CERTIFICATE-----\n" +
      "MIIBkTCB+wIUFakeTestCertificateForProvenanceTests=\n" +
      "-----END CERTIFICATE-----\n";

    /**
     * Create the full set of GitHub Actions env vars needed for provenance.
     */
    function githubActionsEnv(overrides: Record<string, string> = {}) {
      return {
        ...env,
        GITHUB_ACTIONS: "true",
        GITHUB_WORKFLOW_REF: "test-owner/test-repo/.github/workflows/publish.yml@refs/heads/main",
        GITHUB_REPOSITORY: "test-owner/test-repo",
        GITHUB_EVENT_NAME: "push",
        GITHUB_REPOSITORY_ID: "123456",
        GITHUB_REPOSITORY_OWNER_ID: "789012",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: "abcdef1234567890abcdef1234567890abcdef12",
        RUNNER_ENVIRONMENT: "github-hosted",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "1",
        ...overrides,
      };
    }

    /**
     * Create a mock OIDC server that returns a JWT.
     */
    function createMockOIDCServer() {
      return Bun.serve({
        port: 0,
        fetch(req) {
          // Verify audience parameter is present
          const url = new URL(req.url);
          if (url.searchParams.get("audience") !== "sigstore") {
            return new Response("Missing audience=sigstore", { status: 400 });
          }
          return new Response(JSON.stringify({ value: MOCK_JWT }), {
            headers: { "content-type": "application/json" },
          });
        },
      });
    }

    /**
     * Create a mock Fulcio server that returns a PEM certificate.
     * Captures the request body for verification.
     */
    function createMockFulcioServer(captured: { body?: any }) {
      return Bun.serve({
        port: 0,
        async fetch(req) {
          if (req.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
          }
          captured.body = await req.json();
          // Return a mock PEM certificate chain
          return new Response(MOCK_PEM_CERT, {
            status: 201,
            headers: { "content-type": "application/pem-certificate-chain" },
          });
        },
      });
    }

    /**
     * Create a mock Rekor server that returns a log entry.
     * Captures the request body for verification.
     */
    function createMockRekorServer(captured: { body?: any }) {
      return Bun.serve({
        port: 0,
        async fetch(req) {
          if (req.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
          }
          captured.body = await req.json();

          // Return a mock Rekor log entry
          const uuid = "deadbeef1234567890abcdef";
          const entry = {
            [uuid]: {
              body: btoa("mock-canonical-body"),
              integratedTime: 1700000000,
              logID: "c0ffee",
              logIndex: 12345,
              verification: {
                signedEntryTimestamp: btoa("mock-set"),
                inclusionProof: {
                  logIndex: 12345,
                  rootHash: "aabbccdd",
                  treeSize: 99999,
                  hashes: ["11223344", "55667788"],
                  checkpoint: "mock-checkpoint-envelope",
                },
              },
            },
          };
          return new Response(JSON.stringify(entry), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        },
      });
    }

    /**
     * Create a mock npm registry that captures the PUT body.
     */
    function createMockRegistryServer(captured: { body?: any }) {
      return Bun.serve({
        port: 0,
        async fetch(req) {
          if (req.method === "PUT") {
            captured.body = await req.json();
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          }
          // Handle GET requests for package metadata (needed before PUT)
          return new Response(JSON.stringify({}), { status: 404 });
        },
      });
    }

    test("end-to-end: generates and attaches provenance bundle to publish request", async () => {
      const fulcioCaptured: { body?: any } = {};
      const rekorCaptured: { body?: any } = {};
      const registryCaptured: { body?: any } = {};

      using oidcServer = createMockOIDCServer();
      using fulcioServer = createMockFulcioServer(fulcioCaptured);
      using rekorServer = createMockRekorServer(rekorCaptured);
      using registryServer = createMockRegistryServer(registryCaptured);

      const dir = tmpdirSync();

      const bunfig = `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}", token = "test-token" }`;

      await Promise.all([
        write(
          join(dir, "package.json"),
          JSON.stringify({
            name: "provenance-e2e-pkg",
            version: "1.0.0",
          }),
        ),
        write(join(dir, "bunfig.toml"), bunfig),
        write(join(dir, "index.js"), "module.exports = {}"),
      ]);

      const { exitCode } = await publish(
        githubActionsEnv({
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-bearer-token",
          SIGSTORE_FULCIO_URL: `http://localhost:${fulcioServer.port}/api/v2/signingCert`,
          SIGSTORE_REKOR_URL: `http://localhost:${rekorServer.port}/api/v1/log/entries`,
        }),
        dir,
        "--provenance",
      );

      // == Verify Fulcio request (Section 5) ==
      expect(fulcioCaptured.body).toBeDefined();
      expect(fulcioCaptured.body.credentials).toBeDefined();
      expect(fulcioCaptured.body.credentials.oidcIdentityToken).toBe(MOCK_JWT);
      expect(fulcioCaptured.body.publicKeyRequest).toBeDefined();
      expect(fulcioCaptured.body.publicKeyRequest.publicKey.algorithm).toBe("ECDSA");
      // Public key should be PEM-encoded (starts with -----BEGIN PUBLIC KEY-----)
      expect(fulcioCaptured.body.publicKeyRequest.publicKey.content).toContain("BEGIN PUBLIC KEY");
      // Proof of possession should be base64-encoded
      expect(fulcioCaptured.body.publicKeyRequest.proofOfPossession).toBeDefined();
      expect(typeof fulcioCaptured.body.publicKeyRequest.proofOfPossession).toBe("string");

      // == Verify Rekor request (Section 8) ==
      expect(rekorCaptured.body).toBeDefined();
      expect(rekorCaptured.body.apiVersion).toBe("0.0.2");
      expect(rekorCaptured.body.kind).toBe("dsse");
      expect(rekorCaptured.body.spec.proposedContent).toBeDefined();
      expect(rekorCaptured.body.spec.proposedContent.verifiers).toBeArrayOfSize(1);
      // The verifier should be the PEM certificate
      expect(rekorCaptured.body.spec.proposedContent.verifiers[0]).toContain("CERTIFICATE");

      // DSSE envelope should be valid JSON string
      const dsseEnvelopeStr = rekorCaptured.body.spec.proposedContent.envelope;
      expect(typeof dsseEnvelopeStr).toBe("string");
      const dsseEnvelope = JSON.parse(dsseEnvelopeStr);
      expect(dsseEnvelope.payloadType).toBe("application/vnd.in-toto+json");
      expect(dsseEnvelope.payload).toBeDefined();
      expect(dsseEnvelope.signatures).toBeArray();
      expect(dsseEnvelope.signatures.length).toBe(1);
      expect(dsseEnvelope.signatures[0].sig).toBeDefined();

      // == Verify DSSE payload is SLSA provenance (Section 6 & 7) ==
      const payloadJson = atob(dsseEnvelope.payload);

      const payload = JSON.parse(payloadJson);
      expect(payload._type).toBe("https://in-toto.io/Statement/v1");
      expect(payload.predicateType).toBe("https://slsa.dev/provenance/v1");

      // Subject should contain the package PURL
      expect(payload.subject).toBeArrayOfSize(1);
      expect(payload.subject[0].name).toBe("pkg:npm/provenance-e2e-pkg@1.0.0");
      expect(payload.subject[0].digest.sha512).toBeDefined();
      // SHA-512 hex digest should be 128 characters
      expect(payload.subject[0].digest.sha512).toHaveLength(128);
      // Should be lowercase hex
      expect(payload.subject[0].digest.sha512).toMatch(/^[0-9a-f]{128}$/);

      // Build definition
      expect(payload.predicate.buildDefinition.buildType).toBe(
        "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      );
      expect(payload.predicate.buildDefinition.externalParameters.workflow.repository).toBe(
        "https://github.com/test-owner/test-repo",
      );
      expect(payload.predicate.buildDefinition.externalParameters.workflow.ref).toBe("refs/heads/main");
      expect(payload.predicate.buildDefinition.externalParameters.workflow.path).toBe(
        "test-owner/test-repo/.github/workflows/publish.yml",
      );

      // Internal parameters
      expect(payload.predicate.buildDefinition.internalParameters.github.event_name).toBe("push");
      expect(payload.predicate.buildDefinition.internalParameters.github.repository_id).toBe("123456");
      expect(payload.predicate.buildDefinition.internalParameters.github.repository_owner_id).toBe("789012");

      // Resolved dependencies
      expect(payload.predicate.buildDefinition.resolvedDependencies).toBeArrayOfSize(1);
      expect(payload.predicate.buildDefinition.resolvedDependencies[0].uri).toBe(
        "git+https://github.com/test-owner/test-repo@refs/heads/main",
      );
      expect(payload.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit).toBe(
        "abcdef1234567890abcdef1234567890abcdef12",
      );

      // Run details
      expect(payload.predicate.runDetails.metadata.invocationId).toBe(
        "https://github.com/test-owner/test-repo/actions/runs/42/attempts/1",
      );

      // == Verify registry publish request (Section 10) ==
      expect(registryCaptured.body).toBeDefined();
      expect(registryCaptured.body._attachments).toBeDefined();

      // Should have tarball attachment
      const tarballKey = "provenance-e2e-pkg-1.0.0.tgz";
      expect(registryCaptured.body._attachments[tarballKey]).toBeDefined();

      // Should have sigstore attachment
      const sigstoreKey = "provenance-e2e-pkg-1.0.0.sigstore";
      expect(registryCaptured.body._attachments[sigstoreKey]).toBeDefined();

      const sigstoreAttachment = registryCaptured.body._attachments[sigstoreKey];
      expect(sigstoreAttachment.content_type).toBe("application/vnd.dev.sigstore.bundle.v0.3+json");

      // data should be the raw JSON bundle string (not base64)
      expect(typeof sigstoreAttachment.data).toBe("string");
      const bundle = JSON.parse(sigstoreAttachment.data);

      // length should be the byte length of the bundle JSON string
      expect(sigstoreAttachment.length).toBe(sigstoreAttachment.data.length);

      // == Verify Sigstore bundle structure (Section 9) ==
      expect(bundle.mediaType).toBe("application/vnd.dev.sigstore.bundle.v0.3+json");

      // dsseEnvelope should be an embedded object (not a string)
      expect(typeof bundle.dsseEnvelope).toBe("object");
      expect(bundle.dsseEnvelope.payloadType).toBe("application/vnd.in-toto+json");
      expect(bundle.dsseEnvelope.payload).toBeDefined();
      expect(bundle.dsseEnvelope.signatures).toBeArray();

      // verificationMaterial
      expect(bundle.verificationMaterial).toBeDefined();

      // v0.3 uses "certificate" (singular), not x509CertificateChain
      expect(bundle.verificationMaterial.certificate).toBeDefined();
      expect(bundle.verificationMaterial.certificate.rawBytes).toBeDefined();
      // rawBytes should be base64-encoded DER (no PEM markers)
      expect(bundle.verificationMaterial.certificate.rawBytes).not.toContain("BEGIN");

      // tlogEntries
      expect(bundle.verificationMaterial.tlogEntries).toBeArrayOfSize(1);
      const tlogEntry = bundle.verificationMaterial.tlogEntries[0];
      expect(tlogEntry.logIndex).toBe("12345"); // protobuf int64 as string
      expect(tlogEntry.integratedTime).toBe("1700000000"); // protobuf int64 as string
      expect(tlogEntry.kindVersion).toEqual({ kind: "dsse", version: "0.0.2" });
      expect(tlogEntry.canonicalizedBody).toBeDefined();

      // logId.keyId should be base64-encoded (from hex "c0ffee")
      expect(tlogEntry.logId).toBeDefined();
      expect(tlogEntry.logId.keyId).toBeDefined();

      // inclusionPromise
      expect(tlogEntry.inclusionPromise).toBeDefined();
      expect(tlogEntry.inclusionPromise.signedEntryTimestamp).toBeDefined();

      // inclusionProof
      expect(tlogEntry.inclusionProof).toBeDefined();
      expect(tlogEntry.inclusionProof.logIndex).toBe("12345");
      expect(tlogEntry.inclusionProof.treeSize).toBe("99999");
      expect(tlogEntry.inclusionProof.hashes).toBeArray();
      expect(tlogEntry.inclusionProof.checkpoint).toBeDefined();
      expect(tlogEntry.inclusionProof.checkpoint.envelope).toBe("mock-checkpoint-envelope");

      // The publish should have succeeded
      expect(exitCode).toBe(0);
    }, 10_000);

    test("scoped package generates correct PURL with %40 encoding", async () => {
      const fulcioCaptured: { body?: any } = {};
      const rekorCaptured: { body?: any } = {};
      const registryCaptured: { body?: any } = {};

      using oidcServer = createMockOIDCServer();
      using fulcioServer = createMockFulcioServer(fulcioCaptured);
      using rekorServer = createMockRekorServer(rekorCaptured);
      using registryServer = createMockRegistryServer(registryCaptured);

      const dir = tmpdirSync();

      const bunfig = `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}", token = "test-token" }`;

      await Promise.all([
        write(
          join(dir, "package.json"),
          JSON.stringify({
            name: "@my-scope/my-pkg",
            version: "2.0.0-beta.1",
          }),
        ),
        write(join(dir, "bunfig.toml"), bunfig),
      ]);

      const { exitCode } = await publish(
        githubActionsEnv({
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
          SIGSTORE_FULCIO_URL: `http://localhost:${fulcioServer.port}/api/v2/signingCert`,
          SIGSTORE_REKOR_URL: `http://localhost:${rekorServer.port}/api/v1/log/entries`,
        }),
        dir,
        "--provenance",
      );

      // Verify SLSA predicate subject
      const dsseEnvelopeStr = rekorCaptured.body.spec.proposedContent.envelope;
      const dsseEnvelope = JSON.parse(dsseEnvelopeStr);
      const payloadJson = atob(dsseEnvelope.payload);
      const payload = JSON.parse(payloadJson);

      // Scoped package: @ should be URL-encoded as %40
      expect(payload.subject[0].name).toBe("pkg:npm/%40my-scope/my-pkg@2.0.0-beta.1");

      // Verify sigstore attachment key uses scoped name
      expect(registryCaptured.body._attachments["@my-scope/my-pkg-2.0.0-beta.1.sigstore"]).toBeDefined();

      expect(exitCode).toBe(0);
    });

    test("--dry-run with valid CI skips signing but shows provenance info", async () => {
      using oidcServer = createMockOIDCServer();

      const dir = tmpdirSync();

      const bunfig = `[install]\ncache = false`;

      await Promise.all([
        write(
          join(dir, "package.json"),
          JSON.stringify({
            name: "provenance-dryrun-pkg",
            version: "1.0.0",
          }),
        ),
        write(join(dir, "bunfig.toml"), bunfig),
      ]);

      const { out, exitCode } = await publish(
        githubActionsEnv({
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
        }),
        dir,
        "--provenance",
        "--dry-run",
      );

      // Should show provenance info (goes to stdout via Output.prettyln)
      expect(out).toContain("Provenance");
      expect(out).toContain("GitHub Actions");
      // Should succeed (dry-run)
      expect(exitCode).toBe(0);
    });

    test("Fulcio server failure produces clear error", async () => {
      using oidcServer = createMockOIDCServer();

      const failingFulcio = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Internal Server Error", { status: 500 });
        },
      });

      const dir = tmpdirSync();
      const bunfig = `[install]\ncache = false`;

      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify({ name: "provenance-fulcio-fail", version: "1.0.0" })),
        write(join(dir, "bunfig.toml"), bunfig),
      ]);

      const { err, exitCode } = await publish(
        githubActionsEnv({
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
          SIGSTORE_FULCIO_URL: `http://localhost:${failingFulcio.port}/api/v2/signingCert`,
        }),
        dir,
        "--provenance",
      );

      failingFulcio.stop();

      expect(err).toContain("Fulcio");
      expect(exitCode).not.toBe(0);
    });

    test("Rekor server failure produces clear error", async () => {
      const fulcioCaptured: { body?: any } = {};

      using oidcServer = createMockOIDCServer();
      using fulcioServer = createMockFulcioServer(fulcioCaptured);

      const failingRekor = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Service Unavailable", { status: 503 });
        },
      });

      const dir = tmpdirSync();
      const bunfig = `[install]\ncache = false`;

      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify({ name: "provenance-rekor-fail", version: "1.0.0" })),
        write(join(dir, "bunfig.toml"), bunfig),
      ]);

      const { err, exitCode } = await publish(
        githubActionsEnv({
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
          SIGSTORE_FULCIO_URL: `http://localhost:${fulcioServer.port}/api/v2/signingCert`,
          SIGSTORE_REKOR_URL: `http://localhost:${failingRekor.port}/api/v1/log/entries`,
        }),
        dir,
        "--provenance",
      );

      failingRekor.stop();

      expect(err).toContain("Rekor");
      expect(exitCode).not.toBe(0);
    });

    test("GitHub Enterprise: non-standard GITHUB_SERVER_URL is used in provenance", async () => {
      const rekorCaptured: { body?: any } = {};

      using oidcServer = createMockOIDCServer();
      using fulcioServer = createMockFulcioServer({});
      using rekorServer = createMockRekorServer(rekorCaptured);
      using registryServer = createMockRegistryServer({});

      const dir = tmpdirSync();
      const bunfig = `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}", token = "test-token" }`;

      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify({ name: "provenance-ghe-pkg", version: "1.0.0" })),
        write(join(dir, "bunfig.toml"), bunfig),
      ]);

      const { exitCode } = await publish(
        githubActionsEnv({
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
          SIGSTORE_FULCIO_URL: `http://localhost:${fulcioServer.port}/api/v2/signingCert`,
          SIGSTORE_REKOR_URL: `http://localhost:${rekorServer.port}/api/v1/log/entries`,
          GITHUB_SERVER_URL: "https://github.mycompany.com",
        }),
        dir,
        "--provenance",
      );

      // Extract SLSA predicate and verify custom server URL
      const dsseEnvelopeStr = rekorCaptured.body.spec.proposedContent.envelope;
      const dsseEnvelope = JSON.parse(dsseEnvelopeStr);
      const payloadJson = atob(dsseEnvelope.payload);
      const payload = JSON.parse(payloadJson);

      expect(payload.predicate.buildDefinition.externalParameters.workflow.repository).toBe(
        "https://github.mycompany.com/test-owner/test-repo",
      );
      expect(payload.predicate.buildDefinition.resolvedDependencies[0].uri).toContain("github.mycompany.com");

      expect(exitCode).toBe(0);
    });

    test("provenance attachment is inside _attachments alongside tarball", async () => {
      // Regression test: verify the sigstore attachment is inside _attachments,
      // not at the top level of the JSON body
      const registryCaptured: { body?: any } = {};

      using oidcServer = createMockOIDCServer();
      using fulcioServer = createMockFulcioServer({});
      using rekorServer = createMockRekorServer({});
      using registryServer = createMockRegistryServer(registryCaptured);

      const dir = tmpdirSync();
      const bunfig = `[install]\ncache = false\nregistry = { url = "http://localhost:${registryServer.port}", token = "test-token" }`;

      await Promise.all([
        write(join(dir, "package.json"), JSON.stringify({ name: "provenance-attach-test", version: "3.0.0" })),
        write(join(dir, "bunfig.toml"), bunfig),
      ]);

      const { exitCode } = await publish(
        githubActionsEnv({
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://localhost:${oidcServer.port}/token`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-token",
          SIGSTORE_FULCIO_URL: `http://localhost:${fulcioServer.port}/api/v2/signingCert`,
          SIGSTORE_REKOR_URL: `http://localhost:${rekorServer.port}/api/v1/log/entries`,
        }),
        dir,
        "--provenance",
      );

      const body = registryCaptured.body;
      expect(body).toBeDefined();

      // The sigstore key should be inside _attachments
      const attachments = body._attachments;
      expect(attachments).toBeDefined();

      const tgzKey = "provenance-attach-test-3.0.0.tgz";
      const sigstoreKey = "provenance-attach-test-3.0.0.sigstore";

      // Both should be in _attachments
      expect(attachments[tgzKey]).toBeDefined();
      expect(attachments[sigstoreKey]).toBeDefined();

      // The sigstore key should NOT be at the top level
      expect(body[sigstoreKey]).toBeUndefined();

      // Verify the bundle inside data is valid JSON (not double-encoded)
      const bundleStr = attachments[sigstoreKey].data;
      const bundle = JSON.parse(bundleStr);
      expect(bundle.mediaType).toBe("application/vnd.dev.sigstore.bundle.v0.3+json");

      expect(exitCode).toBe(0);
    });
  });

  // ============================================================================
  // Section 11: Error Handling & User Experience
  // ============================================================================

  describe("error messages are human-readable", () => {
    test("all provenance errors produce user-friendly messages, not stack traces", async () => {
      const { dir, pkgJson, bunfig } = createPackageDir({
        name: "provenance-errmsg-1",
        version: "1.0.0",
      });

      await Promise.all([write(join(dir, "package.json"), pkgJson), write(join(dir, "bunfig.toml"), bunfig)]);

      const { err, exitCode } = await publish(
        {
          ...env,
          GITHUB_ACTIONS: undefined,
          GITLAB_CI: undefined,
          CI: undefined,
        },
        dir,
        "--provenance",
      );

      // Should not contain stack trace indicators
      expect(err).not.toContain("panicked");
      expect(err).not.toContain("thread");
      expect(err).not.toContain("0x"); // memory addresses
      expect(err).not.toContain("src/cli/provenance.zig"); // source file paths
      expect(exitCode).not.toBe(0);
    });

    test("--provenance appears in help output", async () => {
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "publish", "--help"],
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      const [out, err] = await Promise.all([stdout.text(), stderr.text(), exited]);

      const combined = out + err;
      expect(combined).toContain("--provenance");
    });
  });
});
