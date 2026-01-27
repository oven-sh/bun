/**
 * This file can be directly run
 *
 *  PACKAGE_DIR_TO_USE=(realpath .) bun test/cli/install/dummy.registry.ts
 *
 * ## Concurrent Test Support
 *
 * This module supports running tests concurrently by using URL prefixes to isolate
 * each test's registry requests. Each test gets a unique context with:
 * - Its own handler for registry requests
 * - Its own package_dir (temp directory)
 * - Its own request counter
 * - A unique registry URL with a prefix (e.g., http://localhost:PORT/test-123/)
 *
 * ### Usage for concurrent tests:
 * ```typescript
 * it("my test", async () => {
 *   const ctx = await createTestContext({ linker: "hoisted" });
 *   try {
 *     const urls: string[] = [];
 *     setContextHandler(ctx, dummyRegistry(urls, ctx));
 *     // Use ctx.package_dir, ctx.registry_url, ctx.requested
 *     await writeFile(join(ctx.package_dir, "package.json"), ...);
 *   } finally {
 *     destroyTestContext(ctx);
 *   }
 * });
 * ```
 */
import { file, Server } from "bun";
import { tmpdirSync } from "harness";

let expect: (typeof import("bun:test"))["expect"];

import { writeFile } from "fs/promises";
import { basename, join } from "path";

type Handler = (req: Request) => Response | Promise<Response>;
type Pkg = {
  name: string;
  version: string;
  dist: {
    tarball: string;
  };
};

let server: Server;
export let root_url: string;
export let check_npm_auth_type = { check: true };

// ============================================================================
// Concurrent Test Context Support
// ============================================================================

/** Global counter for generating unique test IDs */
let testIdCounter = 0;

/**
 * Context for a single test, containing all per-test state.
 * Use this for concurrent test execution.
 */
export interface TestContext {
  /** Unique identifier for this test context (e.g., "test-1") */
  id: string;
  /** The package directory for this test (a unique temp directory) */
  package_dir: string;
  /** Number of requests made to this test's handler */
  requested: number;
  /** The handler for this test's registry requests */
  handler: Handler;
  /** The registry URL for this test (includes prefix, e.g., http://localhost:PORT/test-1/) */
  registry_url: string;
}

/** Map of test ID prefix -> test context */
const testContexts = new Map<string, TestContext>();

/** Default handler for unmatched requests */
function defaultHandler(): Response {
  return new Response("Tea Break~", { status: 418 });
}

/**
 * Extract the test ID prefix from a URL path.
 * URL format: /test-123/package-name or /test-123/@scope%2fpackage-name
 */
function extractTestPrefix(url: string): { prefix: string; remainingPath: string } | null {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Match /test-N/ followed by anything
  const match = path.match(/^\/(test-\d+)(\/.*)?$/);
  if (match) {
    return {
      prefix: match[1],
      remainingPath: match[2] || "/",
    };
  }
  return null;
}

/**
 * Creates a new isolated test context for concurrent test execution.
 * Each context has its own handler, package_dir, and request counter.
 *
 * The bunfig.toml is automatically created with the prefixed registry URL.
 *
 * @param opts - Optional configuration for the test context
 * @returns A new TestContext that should be used for all test operations
 */
export async function createTestContext(opts?: { linker: "hoisted" | "isolated" }): Promise<TestContext> {
  const id = `test-${++testIdCounter}`;
  const pkg_dir = tmpdirSync();

  const ctx: TestContext = {
    id,
    package_dir: pkg_dir,
    requested: 0,
    handler: defaultHandler,
    registry_url: `${root_url}/${id}/`,
  };

  testContexts.set(id, ctx);

  // Create bunfig.toml with the prefixed registry URL
  await writeFile(
    join(pkg_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "${ctx.registry_url}"
saveTextLockfile = false
${opts ? `linker = "${opts.linker}"` : ""}
`,
  );

  return ctx;
}

/**
 * Cleans up a test context after the test is done.
 * This removes the context from the registry so requests won't be routed to it.
 */
export function destroyTestContext(ctx: TestContext): void {
  testContexts.delete(ctx.id);
}

/**
 * Sets the handler for a specific test context.
 * The handler will receive all requests that have this context's URL prefix.
 */
export function setContextHandler(ctx: TestContext, newHandler: Handler): void {
  ctx.handler = newHandler;
}

/**
 * Creates a dummy registry handler for a specific test context.
 * This is the concurrent-safe version that uses the context's registry_url for tarballs.
 *
 * @param ctx - The test context (provides registry_url for tarball URLs)
 * @param urls - Array to collect requested URLs (passed by reference)
 * @param info - Package version info (default: { "0.0.2": {} })
 * @param numberOfTimesTo500PerURL - Number of times to return 500 before success (for retry testing)
 */
export function dummyRegistryForContext(
  ctx: TestContext,
  urls: string[],
  info: any = { "0.0.2": {} },
  numberOfTimesTo500PerURL = 0,
): Handler {
  let retryCountsByURL = new Map<string, number>();
  const _handler: Handler = async request => {
    urls.push(request.url);
    const url = request.url.replaceAll("%2f", "/");

    let status = 200;

    if (numberOfTimesTo500PerURL > 0) {
      let currentCount = retryCountsByURL.get(request.url);
      if (currentCount === undefined) {
        retryCountsByURL.set(request.url, numberOfTimesTo500PerURL);
        status = 500;
      } else {
        retryCountsByURL.set(request.url, currentCount - 1);
        status = currentCount > 0 ? 500 : 200;
      }
    }

    expect(request.method).toBe("GET");
    if (url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, basename(url).toLowerCase())), { status });
    }
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    if (check_npm_auth_type.check) {
      expect(request.headers.get("npm-auth-type")).toBe(null);
    }
    expect(await request.text()).toBe("");

    // For context-based requests, strip the test prefix
    const urlObj = new URL(url);
    const pathAfterPrefix = urlObj.pathname.replace(`/${ctx.id}/`, "/");
    const name = pathAfterPrefix.slice(1); // Remove leading slash

    const versions: Record<string, Pkg> = {};
    let version;
    for (version in info) {
      if (!/^[0-9]/.test(version)) continue;
      versions[version] = {
        name,
        version,
        dist: {
          tarball: `${ctx.registry_url}${name}-${info[version].as ?? version}.tgz`,
        },
        ...info[version],
      };
    }

    return new Response(
      JSON.stringify({
        name,
        versions,
        "dist-tags": {
          latest: info.latest ?? version,
        },
      }),
      { status },
    );
  };
  return _handler;
}

/**
 * Creates a dummy registry handler (legacy version for backward compatibility).
 *
 * @param urls - Array to collect requested URLs (passed by reference)
 * @param info - Package version info (default: { "0.0.2": {} })
 * @param numberOfTimesTo500PerURL - Number of times to return 500 before success (for retry testing)
 */
export function dummyRegistry(urls: string[], info: any = { "0.0.2": {} }, numberOfTimesTo500PerURL = 0): Handler {
  let retryCountsByURL = new Map<string, number>();
  const _handler: Handler = async request => {
    urls.push(request.url);
    const url = request.url.replaceAll("%2f", "/");

    let status = 200;

    if (numberOfTimesTo500PerURL > 0) {
      let currentCount = retryCountsByURL.get(request.url);
      if (currentCount === undefined) {
        retryCountsByURL.set(request.url, numberOfTimesTo500PerURL);
        status = 500;
      } else {
        retryCountsByURL.set(request.url, currentCount - 1);
        status = currentCount > 0 ? 500 : 200;
      }
    }

    expect(request.method).toBe("GET");
    if (url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, basename(url).toLowerCase())), { status });
    }
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    if (check_npm_auth_type.check) {
      expect(request.headers.get("npm-auth-type")).toBe(null);
    }
    expect(await request.text()).toBe("");

    const name = url.slice(url.indexOf("/", root_url.length) + 1);
    const versions: Record<string, Pkg> = {};
    let version;
    for (version in info) {
      if (!/^[0-9]/.test(version)) continue;
      versions[version] = {
        name,
        version,
        dist: {
          tarball: `${url}-${info[version].as ?? version}.tgz`,
        },
        ...info[version],
      };
    }

    return new Response(
      JSON.stringify({
        name,
        versions,
        "dist-tags": {
          latest: info.latest ?? version,
        },
      }),
      { status },
    );
  };
  return _handler;
}

// ============================================================================
// Legacy API (for backward compatibility with non-concurrent tests)
// ============================================================================

/** @deprecated Use createTestContext() for concurrent tests */
export let package_dir: string;

/** @deprecated Use ctx.requested for concurrent tests */
export let requested: number;

/** Legacy handler for non-prefixed requests */
let legacyHandler: Handler = defaultHandler;

export async function write(path: string, content: string | object) {
  if (!package_dir) throw new Error("writeToPackageDir() must be called in a test");

  await Bun.write(join(package_dir, path), typeof content === "string" ? content : JSON.stringify(content));
}

export function read(path: string) {
  return Bun.file(join(package_dir, path));
}

/** @deprecated Use setContextHandler() for concurrent tests */
export function setHandler(newHandler: Handler) {
  legacyHandler = newHandler;
}

function resetHandler() {
  setHandler(defaultHandler);
}

export function dummyBeforeAll() {
  server = Bun.serve({
    async fetch(request) {
      const url = request.url;

      // Check if this is a prefixed request (for concurrent tests)
      const prefixInfo = extractTestPrefix(url);
      if (prefixInfo) {
        const ctx = testContexts.get(prefixInfo.prefix);
        if (ctx) {
          ctx.requested++;
          return await ctx.handler(request);
        }
        // Unknown test prefix - return 404
        return new Response(`Unknown test prefix: ${prefixInfo.prefix}`, { status: 404 });
      }

      // Legacy non-prefixed request
      requested++;
      return await legacyHandler(request);
    },
    port: 0,
  });
  root_url = `http://localhost:${server.port}`;
}

export function dummyAfterAll() {
  server.stop();
  testContexts.clear();
}

export function getPort() {
  return server.port;
}

let packageDirGetter: () => string = () => {
  return tmpdirSync();
};

/** @deprecated Use createTestContext() for concurrent tests */
export async function dummyBeforeEach(opts?: { linker: "hoisted" | "isolated" }) {
  resetHandler();
  requested = 0;
  package_dir = packageDirGetter();
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${server.port}/"
saveTextLockfile = false
${opts ? `linker = "${opts.linker}"` : ""}
`,
  );
}

/** @deprecated Use destroyTestContext() for concurrent tests */
export async function dummyAfterEach() {
  resetHandler();
}

if (Bun.main === import.meta.path) {
  // @ts-expect-error
  expect = value => {
    return {
      toBe(expected) {
        if (value !== expected) {
          throw new Error(`Expected ${value} to be ${expected}`);
        }
      },
    };
  };
  if (process.env.PACKAGE_DIR_TO_USE) {
    packageDirGetter = () => process.env.PACKAGE_DIR_TO_USE!;
  }

  await dummyBeforeAll();
  await dummyBeforeEach();
  setHandler(dummyRegistry([]));
  console.log("Running dummy registry!\n\n URL: ", root_url!, "\n", "DIR: ", package_dir!);
} else {
  ({ expect } = Bun.jest(import.meta.path));
}
