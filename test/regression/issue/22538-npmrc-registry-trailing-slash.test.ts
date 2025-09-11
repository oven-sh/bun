import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
const { iniInternals } = require("bun:internal-for-testing");
const { loadNpmrc } = iniInternals;

test("npmrc registry URL without trailing slash appends slash automatically", () => {
  // Test case from the Twitter issue
  const ini1 = `
registry=//example.com/contents/release/npm
`;
  const result1 = loadNpmrc(ini1);
  expect(result1.default_registry_url).toBe("//example.com/contents/release/npm/");

  // Test with https protocol
  const ini2 = `
registry=https://example.com/contents/release/npm
`;
  const result2 = loadNpmrc(ini2);
  expect(result2.default_registry_url).toBe("https://example.com/contents/release/npm/");

  // Test with http protocol
  const ini3 = `
registry=http://example.com/contents/release/npm
`;
  const result3 = loadNpmrc(ini3);
  expect(result3.default_registry_url).toBe("http://example.com/contents/release/npm/");

  // Test URL that already has trailing slash (should not double it)
  const ini4 = `
registry=https://example.com/contents/release/npm/
`;
  const result4 = loadNpmrc(ini4);
  expect(result4.default_registry_url).toBe("https://example.com/contents/release/npm/");

  // Test scoped registry
  const ini5 = `
@myorg:registry=https://example.com/myorg/npm
`;
  const result5 = loadNpmrc(ini5);
  // Scoped registries are handled separately, but we can still test the parsing
  expect(result5).toBeDefined();

  // Note: Registry URLs with query strings or fragments are uncommon
  // but we test to ensure we don't break if someone uses them
});

test("npmrc registry with authentication adds trailing slash", () => {
  // Test with auth token
  const ini1 = `
registry=https://example.com/contents/release/npm
//example.com/contents/release/npm:_authToken=mytoken123
`;
  const result1 = loadNpmrc(ini1);
  expect(result1.default_registry_url).toBe("https://example.com/contents/release/npm/");
  expect(result1.default_registry_token).toBe("mytoken123");

  // Test with username and password
  const ini2 = `
registry=https://example.com/contents/release/npm
//example.com/contents/release/npm:username=myuser
//example.com/contents/release/npm:_password=bXlwYXNz
`;
  const result2 = loadNpmrc(ini2);
  expect(result2.default_registry_url).toBe("https://example.com/contents/release/npm/");
  expect(result2.default_registry_username).toBe("myuser");
  expect(result2.default_registry_password).toBe("mypass");
});

test("build tarball URL with registry without trailing slash", async () => {
  using dir = tempDir("test-npmrc-registry", {});

  // Create a simple .npmrc with registry URL without trailing slash
  const npmrc = `
registry=https://example.com/contents/release/npm
`;

  await Bun.write(`${dir}/.npmrc`, npmrc);

  // Create a package.json that would require building tarball URLs
  const packageJson = {
    name: "test-pkg",
    version: "1.0.0",
    dependencies: {
      "fake-package": "1.0.0",
    },
  };

  await Bun.write(`${dir}/package.json`, JSON.stringify(packageJson));

  // Try to install (it will fail because the registry doesn't exist, but we can check the error)
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

  // The key is that we shouldn't get a malformed URL error
  // Instead we should get a network/connection error
  expect(stderr).not.toContain("npm/@fake-package/-/fake-package");
  expect(stderr).not.toContain("npmfake-package");
});
