import { expect, test } from "bun:test";

const { iniInternals } = require("bun:internal-for-testing");
const { loadNpmrc } = iniInternals;

// Regression tests for https://github.com/oven-sh/bun/issues/28233
// Auth tokens should be matched using npm-compatible path hierarchy matching:
// a token at //host/parent/ should apply to registries at //host/parent/child/.

test("scoped registry: token at parent path matches child registry path", () => {
  const ini = `
@some-scope:registry=https://gitlab.com/api/v4/projects/12345/packages/npm/
//gitlab.com/api/v4/:_authToken=parent-token
`;
  const result = loadNpmrc(ini);
  expect(result.scoped_registries?.["some-scope"]?.token).toBe("parent-token");
});

test("scoped registry: token at root path matches any registry path", () => {
  const ini = `
@some-scope:registry=https://gitlab.com/api/v4/projects/12345/packages/npm/
//gitlab.com/:_authToken=root-token
`;
  const result = loadNpmrc(ini);
  expect(result.scoped_registries?.["some-scope"]?.token).toBe("root-token");
});

test("scoped registry: exact path match still works", () => {
  const ini = `
@some-scope:registry=https://gitlab.com/api/v4/projects/12345/packages/npm/
//gitlab.com/api/v4/projects/12345/packages/npm/:_authToken=exact-token
`;
  const result = loadNpmrc(ini);
  expect(result.scoped_registries?.["some-scope"]?.token).toBe("exact-token");
});

test("scoped registry: most specific (longest) path wins", () => {
  const ini = `
@some-scope:registry=https://gitlab.com/api/v4/projects/12345/packages/npm/
//gitlab.com/:_authToken=root-token
//gitlab.com/api/v4/:_authToken=mid-token
//gitlab.com/api/v4/projects/12345/packages/npm/:_authToken=exact-token
`;
  const result = loadNpmrc(ini);
  expect(result.scoped_registries?.["some-scope"]?.token).toBe("exact-token");
});

test("scoped registry: most specific path wins regardless of order", () => {
  const ini = `
@some-scope:registry=https://gitlab.com/api/v4/projects/12345/packages/npm/
//gitlab.com/api/v4/projects/12345/packages/npm/:_authToken=exact-token
//gitlab.com/api/v4/:_authToken=mid-token
//gitlab.com/:_authToken=root-token
`;
  const result = loadNpmrc(ini);
  expect(result.scoped_registries?.["some-scope"]?.token).toBe("exact-token");
});

test("scoped registry: non-parent path does not match", () => {
  // The token at /api/v4/packages/npm/ is NOT a parent of /api/v4/projects/12345/packages/npm/
  const ini = `
@some-scope:registry=https://gitlab.com/api/v4/projects/12345/packages/npm/
//gitlab.com/api/v4/packages/npm/:_authToken=wrong-token
`;
  const result = loadNpmrc(ini);
  expect(result.scoped_registries?.["some-scope"]?.token).toBe("");
});

test("scoped registry: token only applies to matching scope, not others", () => {
  const ini = `
@myorg:registry=https://somewhere-else.com/myorg/
@another:registry=https://somewhere-else.com/another/
//somewhere-else.com/myorg/:_authToken=MYTOKEN1
//somewhere-else.com/:username=foobar
`;
  const result = loadNpmrc(ini);
  // Token should only apply to @myorg (exact parent match)
  expect(result.scoped_registries?.["myorg"]?.token).toBe("MYTOKEN1");
  // Token for /myorg/ should NOT apply to @another (not a parent path)
  expect(result.scoped_registries?.["another"]?.token).toBe("");
});

test("default registry: token at parent path matches", () => {
  const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:_authToken=root-token
`;
  const result = loadNpmrc(ini);
  expect(result.default_registry_token).toBe("root-token");
});

test("default registry: most specific path wins", () => {
  const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:_authToken=root-token
//somehost.com/org1/npm/registry/:_authToken=exact-token
`;
  const result = loadNpmrc(ini);
  expect(result.default_registry_token).toBe("exact-token");
});

test("default registry: same host different paths - exact match still wins (regression #26350)", () => {
  const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org1/npm/registry/:_authToken=jwt1
//somehost.com/org2/npm/registry/:_authToken=jwt2
//somehost.com/org3/npm/registry/:_authToken=jwt3
`;
  const result = loadNpmrc(ini);
  expect(result.default_registry_url).toEqual("https://somehost.com/org1/npm/registry/");
  expect(result.default_registry_token).toBe("jwt1");
});

test("default registry: non-parent path does not match", () => {
  const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org2/npm/registry/:_authToken=jwt2
`;
  const result = loadNpmrc(ini);
  expect(result.default_registry_url).toEqual("https://somehost.com/org1/npm/registry/");
  expect(result.default_registry_token).toBe("");
});

test("path matching respects segment boundaries", () => {
  // /api/v4 should NOT match /api/v41/... (partial segment match)
  const ini = `
@some-scope:registry=https://gitlab.com/api/v41/projects/
//gitlab.com/api/v4/:_authToken=should-not-match
`;
  const result = loadNpmrc(ini);
  expect(result.scoped_registries?.["some-scope"]?.token).toBe("");
});
