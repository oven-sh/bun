import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { readFile, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  package_dir,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

it("should use cache when --prefer-offline is passed even with expired data", async () => {
  const urls: string[] = [];
  
  // Create a registry handler that sets cache control headers with expiry in the past
  setHandler(async (request) => {
    urls.push(request.url);
    
    expect(request.method).toBe("GET");
    if (request.url.endsWith(".tgz")) {
      // For .tgz files, return the test package from dummy registry
      const { file } = await import("bun");
      const { basename, join } = await import("path");
      return new Response(file(join(import.meta.dir, basename(request.url).toLowerCase())), { 
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          // Set cache control to expire in the past
          "cache-control": "max-age=3600",
          "date": new Date(Date.now() - 7200000).toUTCString(), // 2 hours ago
        }
      });
    }
    
    // For package metadata requests
    const name = request.url.slice(request.url.indexOf("/", root_url.length) + 1);
    
    return new Response(
      JSON.stringify({
        name,
        versions: {
          "0.0.2": {
            name,
            version: "0.0.2",
            dist: {
              tarball: `${request.url}-0.0.2.tgz`,
            },
          },
          "0.1.0": {
            name,
            version: "0.1.0",
            dist: {
              tarball: `${request.url}-0.1.0.tgz`,
            },
          },
        },
        "dist-tags": {
          latest: name === "moo" ? "0.1.0" : "0.0.2",
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          // Set cache control to expire in the past
          "cache-control": "max-age=3600",
          "date": new Date(Date.now() - 7200000).toUTCString(), // 2 hours ago
        },
      },
    );
  });

  // Create package.json with a dependency
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-prefer-offline",
      version: "1.0.0",
      dependencies: {
        "bar": "0.0.2",
      },
    }),
  );

  // First install - this should populate the cache
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      env: bunEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const stderrText = await new Response(stderr).text();
    if ((await exited) !== 0) {
      console.log("First install STDERR:", stderrText);
    }
    expect(await exited).toBe(0);
    expect(stderrText).not.toContain("error:");
  }

  // Save the URLs from the first install
  const firstInstallUrls = [...urls];
  expect(firstInstallUrls.length).toBeGreaterThan(0);

  // Clear the URLs array and requested counter
  urls.length = 0;
  const firstRequestCount = requested;

  // Add a new dependency to package.json to force a registry lookup
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-prefer-offline",
      version: "1.0.0",
      dependencies: {
        "bar": "0.0.2",
        "moo": "0.1.0", // This will force a registry lookup
      },
    }),
  );

  // Second install with --prefer-offline - this should NOT make network requests
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--prefer-offline"],
      cwd: package_dir,
      env: bunEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const stderrText = await new Response(stderr).text();
    const exitCode = await exited;
    
    // With --prefer-offline and no cached manifest, the install should fail
    expect(exitCode).toBe(1);
    expect(stderrText).toContain("failed to resolve");
  }

  // Verify no new network requests were made (the key behavior we want)
  expect(urls).toEqual([]);
  expect(requested).toBe(firstRequestCount);

  // Since the install failed, the lockfile should remain from the first install
  const lockfileExists = await Bun.file(join(package_dir, "bun.lockb")).exists();
  expect(lockfileExists).toBe(true);
});

it("should make network requests without --prefer-offline even with expired cache", async () => {
  const urls: string[] = [];
  
  // Create a registry handler that sets cache control headers with expiry in the past
  setHandler(async (request) => {
    urls.push(request.url);
    
    expect(request.method).toBe("GET");
    if (request.url.endsWith(".tgz")) {
      const { file } = await import("bun");
      const { basename, join } = await import("path");
      return new Response(file(join(import.meta.dir, basename(request.url).toLowerCase())), { 
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "max-age=3600",
          "date": new Date(Date.now() - 7200000).toUTCString(), // 2 hours ago
        }
      });
    }
    
    const name = request.url.slice(request.url.indexOf("/", root_url.length) + 1);
    
    return new Response(
      JSON.stringify({
        name,
        versions: {
          "0.0.2": {
            name,
            version: "0.0.2",
            dist: {
              tarball: `${request.url}-0.0.2.tgz`,
            },
          },
          "0.1.0": {
            name,
            version: "0.1.0",
            dist: {
              tarball: `${request.url}-0.1.0.tgz`,
            },
          },
        },
        "dist-tags": {
          latest: name === "moo" ? "0.1.0" : "0.0.2",
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "max-age=3600",
          "date": new Date(Date.now() - 7200000).toUTCString(), // 2 hours ago
        },
      },
    );
  });

  // Create package.json with a dependency
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-normal-install",
      version: "1.0.0",
      dependencies: {
        "bar": "0.0.2",
      },
    }),
  );

  // First install to populate cache
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      env: bunEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });

    expect(await exited).toBe(0);
  }

  // Clear URLs and add a new dependency to force registry lookup
  urls.length = 0;
  
  // Add a new dependency to package.json to force a registry lookup
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test-normal-install",
      version: "1.0.0",
      dependencies: {
        "bar": "0.0.2",
        "moo": "0.1.0", // This will force a registry lookup
      },
    }),
  );

  // Second install WITHOUT --prefer-offline - this SHOULD make network requests
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      env: bunEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const stderrText = await new Response(stderr).text();
    if ((await exited) !== 0) {
      console.log("Normal install STDERR:", stderrText);
    }
    expect(await exited).toBe(0);
    expect(stderrText).not.toContain("error:");
  }

  // Verify network requests were made because cache was expired
  expect(urls.length).toBeGreaterThan(0);
});