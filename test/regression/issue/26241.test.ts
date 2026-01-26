import { expect, test } from "bun:test";

const { iniInternals } = require("bun:internal-for-testing");
const { loadNpmrc } = iniInternals;

// Test for https://github.com/oven-sh/bun/issues/26241
// GitLab project-specific npm registries should get their correct auth tokens based on path matching,
// not just host matching.

test("multiple GitLab project registries with different paths get correct auth tokens", () => {
  const npmrc = `
@org1:registry=https://gitlab.example.com/api/v4/projects/111/packages/npm/
//gitlab.example.com/api/v4/projects/111/packages/npm/:_authToken=TOKEN_FOR_ORG1

@org2:registry=https://gitlab.example.com/api/v4/projects/222/packages/npm/
//gitlab.example.com/api/v4/projects/222/packages/npm/:_authToken=TOKEN_FOR_ORG2
`;

  const result = loadNpmrc(npmrc);

  expect(result.scoped_registries).toBeDefined();
  // Note: scope names are stored without the @ prefix
  expect(result.scoped_registries["org1"]).toBeDefined();
  expect(result.scoped_registries["org2"]).toBeDefined();

  // Each scope should get its correct token based on path matching
  expect(result.scoped_registries["org1"].token).toBe("TOKEN_FOR_ORG1");
  expect(result.scoped_registries["org2"].token).toBe("TOKEN_FOR_ORG2");

  // Verify the URLs are correct too
  expect(result.scoped_registries["org1"].url).toBe("https://gitlab.example.com/api/v4/projects/111/packages/npm/");
  expect(result.scoped_registries["org2"].url).toBe("https://gitlab.example.com/api/v4/projects/222/packages/npm/");
});

test("GitLab registries with same host but different project paths don't share tokens", () => {
  // Order matters - if only host is matched, the second token would overwrite the first
  const npmrc = `
@first:registry=https://gitlab.company.io/api/v4/projects/100/packages/npm/
//gitlab.company.io/api/v4/projects/100/packages/npm/:_authToken=FIRST_TOKEN

@second:registry=https://gitlab.company.io/api/v4/projects/200/packages/npm/
//gitlab.company.io/api/v4/projects/200/packages/npm/:_authToken=SECOND_TOKEN

@third:registry=https://gitlab.company.io/api/v4/projects/300/packages/npm/
//gitlab.company.io/api/v4/projects/300/packages/npm/:_authToken=THIRD_TOKEN
`;

  const result = loadNpmrc(npmrc);

  // Each scope should keep its own token, not be overwritten by later tokens
  expect(result.scoped_registries["first"].token).toBe("FIRST_TOKEN");
  expect(result.scoped_registries["second"].token).toBe("SECOND_TOKEN");
  expect(result.scoped_registries["third"].token).toBe("THIRD_TOKEN");
});

test("host-only auth token applies to all scopes on same host with root path", () => {
  // When auth is specified at the host level (no path), it should apply to all scopes
  const npmrc = `
@org1:registry=https://registry.example.com/
@org2:registry=https://registry.example.com/
//registry.example.com/:_authToken=SHARED_TOKEN
`;

  const result = loadNpmrc(npmrc);

  // Both scopes should get the same token since the auth is at the host level
  expect(result.scoped_registries["org1"].token).toBe("SHARED_TOKEN");
  expect(result.scoped_registries["org2"].token).toBe("SHARED_TOKEN");
});

test("path-specific auth takes precedence over host-level auth for matching paths", () => {
  const npmrc = `
@org1:registry=https://gitlab.example.com/api/v4/projects/111/packages/npm/
@org2:registry=https://gitlab.example.com/api/v4/projects/222/packages/npm/

//gitlab.example.com/:_authToken=DEFAULT_TOKEN
//gitlab.example.com/api/v4/projects/111/packages/npm/:_authToken=SPECIFIC_TOKEN_111
`;

  const result = loadNpmrc(npmrc);

  // @org1 should get the specific token for project 111
  expect(result.scoped_registries["org1"].token).toBe("SPECIFIC_TOKEN_111");
  // @org2 should only get the default token (path doesn't match)
  expect(result.scoped_registries["org2"].token).toBe("DEFAULT_TOKEN");
});

test("trailing slashes in paths are normalized during matching", () => {
  const npmrc = `
@withslash:registry=https://gitlab.example.com/api/v4/projects/111/packages/npm/
//gitlab.example.com/api/v4/projects/111/packages/npm:_authToken=TOKEN_NO_SLASH

@noslash:registry=https://gitlab.example.com/api/v4/projects/222/packages/npm
//gitlab.example.com/api/v4/projects/222/packages/npm/:_authToken=TOKEN_WITH_SLASH
`;

  const result = loadNpmrc(npmrc);

  // Both should work regardless of trailing slash differences
  expect(result.scoped_registries["withslash"].token).toBe("TOKEN_NO_SLASH");
  expect(result.scoped_registries["noslash"].token).toBe("TOKEN_WITH_SLASH");
});
