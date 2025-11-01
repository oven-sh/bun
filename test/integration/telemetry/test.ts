#!/usr/bin/env bun
/**
 * OpenTelemetry Integration Test
 *
 * Tests Bun's OTel instrumentation end-to-end:
 * Bun App (host) → Jaeger v2 (Docker) → Query API → Verify traces
 *
 * Usage: bun test/integration/telemetry/test.ts [--interactive]
 */

import { $ } from "bun";
import { join } from "path";

// Colors for output
const colors = {
  red: (s: string) => `\x1b[0;31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[0;32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[1;33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[0;36m${s}\x1b[0m`,
  reset: "\x1b[0m",
};

// Detect if running in CI/agent environment
function isAutomatedEnvironment(): boolean {
  const env = process.env;
  return !!(
    env.CLAUDECODE ||
    env.GITHUB_ACTIONS ||
    env.CI ||
    env.CODEX_PROXY_CERT ||
    env.JENKINS_HOME ||
    env.BUILDKITE ||
    env.CIRCLECI ||
    env.TRAVIS
  );
}

// Check if interactive mode requested
const isInteractive = process.argv.includes("--interactive") || process.argv.includes("-i");

// Jaeger Docker image
const jaegerImage = "jaegertracing/jaeger:2.10.0";

// Paths
const scriptDir = import.meta.dir;
const repoRoot = join(scriptDir, "../../..");
const bunDebug = join(repoRoot, "build/debug/bun-debug");
const bunOtelDir = join(repoRoot, "packages/bun-otel");
const appPath = join(scriptDir, "app.ts");

console.log(colors.cyan("=== Bun OpenTelemetry Integration Test ===\n"));

// Container and process IDs for cleanup
let jaegerContainer: string | null = null;
let jaegerStartedByUs = false; // Track if we started the container
let bunAppProc: any = null;

// Cleanup function
async function cleanup() {
  console.log(colors.yellow("\nCleaning up..."));

  if (bunAppProc) {
    try {
      bunAppProc.kill();
      console.log(colors.green("✓ Bun app stopped"));
    } catch {}
  }

  if (jaegerContainer && jaegerStartedByUs) {
    try {
      await $`docker stop ${jaegerContainer}`.quiet();
      console.log(colors.green("✓ Jaeger container stopped"));
    } catch {}
  } else if (jaegerContainer) {
    console.log(colors.green("✓ Jaeger container left running (was reused)"));
  }
}

// Setup signal handlers
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

try {
  // Step 1: Install bun-otel dependencies
  console.log(colors.yellow("Installing bun-otel dependencies..."));
  await $`bun --cwd=${bunOtelDir} install`.quiet();
  console.log(colors.green("✓ Dependencies installed\n"));

  // Step 2: Ensure debug build exists
  console.log(colors.yellow("Ensuring debug build exists..."));
  if (!(await Bun.file(bunDebug).exists())) {
    console.log(colors.yellow("Debug build not found, building..."));
    await $`bun bd`;
    console.log(colors.green("✓ Debug build created\n"));
  } else {
    console.log(colors.green(`✓ Using existing debug build: ${bunDebug}\n`));
  }

  // Step 3: Check if Jaeger is already running, or start it
  console.log(colors.yellow("Checking for existing Jaeger container..."));
  try {
    const existingContainer = await $`docker ps -q -f name=bun-telemetry-jaeger -f status=running`.text();
    if (existingContainer.trim()) {
      jaegerContainer = existingContainer.trim();
      jaegerStartedByUs = false;
      console.log(colors.green("✓ Using existing Jaeger container\n"));
    } else {
      throw new Error("No existing container");
    }
  } catch {
    console.log(colors.yellow("Starting Jaeger v2..."));
    const jaegerOutput =
      await $`docker run -d --rm --name bun-telemetry-jaeger -p 0:4318 -p 0:16686 ${jaegerImage}`.text();
    jaegerContainer = jaegerOutput.trim();
    jaegerStartedByUs = true;
    console.log(colors.green("✓ Jaeger started\n"));
  }

  // Step 4: Discover dynamically assigned ports
  console.log(colors.yellow("Discovering Jaeger ports..."));
  const otlpPortOutput = await $`docker port ${jaegerContainer} 4318`.text();
  const uiPortOutput = await $`docker port ${jaegerContainer} 16686`.text();

  const otlpPort = otlpPortOutput.trim().split("\n")[0].split(":")[1];
  const uiPort = uiPortOutput.trim().split("\n")[0].split(":")[1];

  if (!otlpPort || !uiPort) {
    throw new Error("Failed to discover Jaeger ports");
  }

  console.log(colors.cyan(`Jaeger OTLP: http://localhost:${otlpPort}`));
  console.log(colors.cyan(`Jaeger UI: http://localhost:${uiPort}\n`));

  // Step 5: Wait for Jaeger to be ready (v2 takes ~5-10 seconds to fully start)
  console.log(colors.yellow("Waiting for Jaeger UI..."));
  let jaegerReady = false;
  for (let i = 0; i < 60; i++) {
    // Wait 60 * 500ms = 30 seconds max
    try {
      const response = await fetch(`http://localhost:${uiPort}`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        jaegerReady = true;
        break;
      }
    } catch {}
    await Bun.sleep(500);
  }

  if (!jaegerReady) {
    throw new Error("Jaeger UI failed to become ready");
  }
  console.log(colors.green("✓ Jaeger UI ready\n"));

  // Step 6: Start Bun app on host
  console.log(colors.yellow("Starting Bun app on host..."));
  bunAppProc = Bun.spawn([bunDebug, "bd", appPath], {
    env: {
      ...Bun.env,
      BUN_DEBUG_QUIET_LOGS: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${otlpPort}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Step 7: Wait for Bun app to output its port
  console.log(colors.yellow("Waiting for Bun app..."));
  let bunAppPort: string | null = null;

  // Read stdout to get the port
  const stdoutReader = bunAppProc.stdout.getReader();
  let stdoutBuffer = "";

  for (let i = 0; i < 60; i++) {
    try {
      const { value, done } = await stdoutReader.read();
      if (value) {
        const text = new TextDecoder().decode(value);
        stdoutBuffer += text;

        // Look for PORT=XXXX in the output
        const portMatch = stdoutBuffer.match(/PORT=(\d+)/);
        if (portMatch) {
          bunAppPort = portMatch[1];
          stdoutReader.releaseLock();
          break;
        }
      }
      if (done) break;
    } catch {}
    await Bun.sleep(100);
  }

  if (!bunAppPort) {
    console.error(colors.red("✗ Bun app failed to output port\n"));
    console.log(colors.yellow("Bun app stdout:"));
    console.log(stdoutBuffer);
    console.log(colors.yellow("Bun app stderr:"));
    console.log(await bunAppProc.stderr.text());
    await cleanup();
    process.exit(1);
  }

  // Wait for health check to confirm server is ready
  let bunAppReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`http://localhost:${bunAppPort}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        bunAppReady = true;
        break;
      }
    } catch {}
    await Bun.sleep(500);
  }

  if (!bunAppReady) {
    console.error(colors.red("✗ Bun app health check failed\n"));
    await cleanup();
    process.exit(1);
  }

  console.log(colors.green("✓ Bun app ready\n"));
  console.log(colors.cyan(`Bun app: http://localhost:${bunAppPort}\n`));

  // Step 8: Generate load
  console.log(colors.yellow("Generating load..."));

  const useOha = await (async () => {
    try {
      await $`which oha`.quiet();
      return true;
    } catch {
      return false;
    }
  })();

  const bunAppUrl = `http://localhost:${bunAppPort}`;

  if (useOha) {
    console.log(colors.cyan("Using oha for load generation"));

    // Initial warmup and variety
    console.log(colors.cyan("  Warmup requests..."));
    await $`oha -n 100 -c 10 ${bunAppUrl}/api/test`.quiet();
    await $`oha -n 20 -c 5 ${bunAppUrl}/api/test?downstream=true`.quiet();
    await $`oha -n 10 -c 2 ${bunAppUrl}/api/error`.quiet();

    // High-volume load test
    console.log(colors.cyan("  High-volume load test (1000 requests)..."));
    const loadStart = Date.now();
    await $`oha -n 1000 -c 10 ${bunAppUrl}/api/test`.quiet();
    const loadDuration = Date.now() - loadStart;
    console.log(colors.cyan(`  Completed in ${loadDuration}ms (${Math.round(1000 / (loadDuration / 1000))} req/s)`));
  } else {
    console.log(colors.cyan("Using bun fetch for load generation (install oha for better performance)"));

    const requests: Promise<any>[] = [];

    // Regular requests (increased volume)
    for (let i = 0; i < 1000; i++) {
      requests.push(fetch(`${bunAppUrl}/api/test`).catch(() => {}));
    }

    // Distributed tracing requests
    for (let i = 0; i < 20; i++) {
      requests.push(fetch(`${bunAppUrl}/api/test?downstream=true`).catch(() => {}));
    }

    // Error requests
    for (let i = 0; i < 10; i++) {
      requests.push(fetch(`${bunAppUrl}/api/error`).catch(() => {}));
    }

    await Promise.all(requests);
  }

  console.log(colors.green("✓ Load generation complete\n"));

  // Step 9: Wait for traces to be exported and query Jaeger
  console.log(colors.yellow("Waiting for traces in Jaeger..."));
  const jaegerApiUrl = `http://localhost:${uiPort}/api/traces`;

  let traces: { data?: Array<{ traceID: string; spans?: any[] }> } | null = null;
  let traceCount = 0;
  const maxRetries = 30; // 30 * 500ms = 15 seconds max

  for (let i = 0; i < maxRetries; i++) {
    await Bun.sleep(500);

    try {
      const response = await fetch(`${jaegerApiUrl}?service=integration-test-service&limit=200`);
      traces = (await response.json()) as { data?: Array<{ traceID: string; spans?: any[] }> };
      traceCount = (traces.data || []).length;

      if (traceCount > 0) {
        console.log(colors.green(`✓ Found ${traceCount} traces after ${(i + 1) * 500}ms\n`));
        break;
      }
    } catch (error) {
      // Continue retrying
    }

    if (i % 5 === 0 && i > 0) {
      console.log(colors.yellow(`  Still waiting... (${i * 500}ms elapsed)`));
    }
  }

  if (traceCount === 0) {
    console.error(colors.red("✗ Failed! No traces found in Jaeger after 15 seconds\n"));

    console.log(colors.yellow("Bun app stdout:"));
    console.log(await bunAppProc.stdout.text());
    console.log(colors.yellow("Bun app stderr:"));
    console.log(await bunAppProc.stderr.text());

    await cleanup();
    process.exit(1);
  }

  // Step 10: Analyze and display results
  console.log(colors.green(`✓ Success! Found ${traceCount} traces in Jaeger\n`));

  // Count multi-span traces (distributed tracing)
  const distributedTraces = (traces!.data || []).filter(t => (t.spans || []).length > 1).length;

  // Count error spans
  let errorSpans = 0;
  for (const trace of traces!.data || []) {
    for (const span of trace.spans || []) {
      for (const tag of (span as any).tags || []) {
        if (tag.key === "error" && tag.value === true) errorSpans++;
      }
    }
  }

  console.log(colors.cyan("=== Test Results ==="));
  console.log(`Total traces:          ${traceCount}`);
  console.log(`Distributed traces:    ${distributedTraces} (multi-span)`);
  console.log(`Error spans:           ${errorSpans}`);
  console.log();

  // Show sample traces
  console.log(colors.cyan("Sample traces:"));
  for (const trace of (traces!.data || []).slice(0, 5)) {
    const spanCount = (trace.spans || []).length;
    console.log(`  ${trace.traceID.substring(0, 16)}... | ${spanCount} span${spanCount !== 1 ? "s" : ""}`);
  }
  console.log();

  // Step 11: Prompt for cleanup
  console.log(colors.cyan(`Open UI:    http://localhost:${uiPort}\n`));

  const shouldCleanup = await (async (): Promise<boolean> => {
    if (isAutomatedEnvironment() && !isInteractive) {
      console.log(colors.yellow("Running in automated environment, cleaning up..."));
      return true;
    }

    if (!isInteractive) {
      console.log(colors.yellow("Use --interactive or -i flag to keep containers running"));
      return true;
    }

    console.log(colors.yellow("Cleanup running containers? [Y/n] (auto-cleanup in 60s)"));

    const { promise, resolve } = Promise.withResolvers<boolean>();

    // Setup timeout
    const timeout = setTimeout(() => {
      console.log(colors.yellow("\nTimeout reached, cleaning up..."));
      resolve(true);
    }, 60000);

    // Read stdin
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data: Buffer) => {
      clearTimeout(timeout);
      const key = data.toString();

      if (key === "\r" || key === "\n" || key.toLowerCase() === "y") {
        resolve(true);
      } else if (key.toLowerCase() === "n") {
        resolve(false);
      } else if (key === "\u0003") {
        // Ctrl+C
        resolve(true);
      }
    });

    return promise;
  })();

  if (shouldCleanup) {
    await cleanup();
    console.log(colors.green("\n✓ Integration test complete!"));
    process.exit(0);
  } else {
    console.log(colors.cyan("\nContainers left running for inspection."));
    console.log(colors.yellow(`To cleanup: docker stop bun-telemetry-jaeger`));
    console.log(colors.yellow(" ctrl+c to stop Bun app"));
  }
} catch (error) {
  console.error(colors.red(`\nError: ${error}`));
  await cleanup();
  process.exit(1);
}
