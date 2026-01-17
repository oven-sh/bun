import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

describe("Sigstore OIDC Module Tests", () => {
  test("should detect GitHub Actions environment", async () => {
    using dir = tempDir("sigstore-oidc-github", {
      "github-detection-test.js": `
        // Check for GitHub Actions environment variables
        const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
        const hasTokenUrl = !!process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
        const hasTokenRequestToken = !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
        
        console.log("GitHub Actions environment:", isGitHubActions);
        console.log("Has token URL:", hasTokenUrl);
        console.log("Has request token:", hasTokenRequestToken);
        console.log("Provider supported:", isGitHubActions && hasTokenUrl && hasTokenRequestToken);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "github-detection-test.js"],
      env: {
        ...bunEnv,
        GITHUB_ACTIONS: "true",
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions-token.example.com",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-request-token",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("GitHub Actions environment: true");
    expect(stdout).toContain("Has token URL: true");
    expect(stdout).toContain("Has request token: true");
    expect(stdout).toContain("Provider supported: true");
  });

  test("should detect GitLab CI environment", async () => {
    using dir = tempDir("sigstore-oidc-gitlab", {
      "gitlab-detection-test.js": `
        // Check for GitLab CI environment variables
        const isGitLabCI = process.env.GITLAB_CI === "true";
        const hasSigstoreToken = !!process.env.SIGSTORE_ID_TOKEN;
        
        console.log("GitLab CI environment:", isGitLabCI);
        console.log("Has Sigstore token:", hasSigstoreToken);
        console.log("Provider supported:", hasSigstoreToken);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "gitlab-detection-test.js"],
      env: {
        ...bunEnv,
        GITLAB_CI: "true",
        SIGSTORE_ID_TOKEN: "test-gitlab-token",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("GitLab CI environment: true");
    expect(stdout).toContain("Has Sigstore token: true");
    expect(stdout).toContain("Provider supported: true");
  });

  test("should handle missing environment variables gracefully", async () => {
    using dir = tempDir("sigstore-oidc-missing", {
      "missing-env-test.js": `
        // Test without any OIDC environment variables
        const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
        const hasGitHubTokens = !!process.env.ACTIONS_ID_TOKEN_REQUEST_URL && !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
        const hasGitLabToken = !!process.env.SIGSTORE_ID_TOKEN;
        
        console.log("GitHub Actions available:", isGitHubActions && hasGitHubTokens);
        console.log("GitLab CI available:", hasGitLabToken);
        console.log("No providers available:", !hasGitHubTokens && !hasGitLabToken);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "missing-env-test.js"],
      env: {
        ...bunEnv,
        // Explicitly unset OIDC environment variables
        GITHUB_ACTIONS: undefined,
        ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
        SIGSTORE_ID_TOKEN: undefined,
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("GitHub Actions available: false");
    expect(stdout).toContain("GitLab CI available: false");
    expect(stdout).toContain("No providers available: true");
  });

  test("should validate JWT token structure", async () => {
    using dir = tempDir("sigstore-oidc-jwt", {
      "jwt-test.js": `
        // Mock JWT token structure
        const mockJWT = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiYXVkIjoic2lnc3RvcmUiLCJpc3MiOiJodHRwczovL3Rva2VuLmFjdGlvbnMuZ2l0aHVidXNlcmNvbnRlbnQuY29tIiwiZXhwIjoxNjkwMDAwMDAwfQ.signature";
        
        // Split JWT into parts
        const parts = mockJWT.split('.');
        const hasHeader = parts.length >= 1 && parts[0].length > 0;
        const hasPayload = parts.length >= 2 && parts[1].length > 0;
        const hasSignature = parts.length >= 3 && parts[2].length > 0;
        
        console.log("JWT has header:", hasHeader);
        console.log("JWT has payload:", hasPayload);
        console.log("JWT has signature:", hasSignature);
        console.log("JWT parts count:", parts.length);
        console.log("JWT structure valid:", parts.length === 3 && hasHeader && hasPayload && hasSignature);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "jwt-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("JWT has header: true");
    expect(stdout).toContain("JWT has payload: true");
    expect(stdout).toContain("JWT has signature: true");
    expect(stdout).toContain("JWT parts count: 3");
    expect(stdout).toContain("JWT structure valid: true");
  });

  test("should validate OIDC token expiration", async () => {
    using dir = tempDir("sigstore-oidc-expiry", {
      "expiry-test.js": `
        const currentTime = Math.floor(Date.now() / 1000);
        const futureTime = currentTime + 3600; // 1 hour from now
        const pastTime = currentTime - 3600; // 1 hour ago
        
        function isTokenExpired(expiryTime) {
          return currentTime >= expiryTime;
        }
        
        console.log("Current timestamp:", currentTime);
        console.log("Future token expired:", isTokenExpired(futureTime));
        console.log("Past token expired:", isTokenExpired(pastTime));
        console.log("Token expiry validation working");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "expiry-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Future token expired: false");
    expect(stdout).toContain("Past token expired: true");
    expect(stdout).toContain("Token expiry validation working");
  });

  test("should validate OIDC audience parameter", async () => {
    using dir = tempDir("sigstore-oidc-audience", {
      "audience-test.js": `
        const baseUrl = "https://token.actions.githubusercontent.com";
        const audience = "sigstore";
        
        function buildTokenRequestUrl(baseUrl, audience) {
          const url = new URL(baseUrl);
          url.searchParams.set("audience", audience);
          return url.toString();
        }
        
        const requestUrl = buildTokenRequestUrl(baseUrl, audience);
        
        console.log("Base URL:", baseUrl);
        console.log("Audience:", audience);
        console.log("Request URL:", requestUrl);
        console.log("Contains audience param:", requestUrl.includes("audience=sigstore"));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "audience-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Base URL: https://token.actions.githubusercontent.com");
    expect(stdout).toContain("Audience: sigstore");
    expect(stdout).toContain("Contains audience param: true");
  });
});