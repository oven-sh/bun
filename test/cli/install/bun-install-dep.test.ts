import { npa } from "bun:internal-for-testing";
import { expect, test, describe } from "bun:test";

const TEST_DEPENDENCIES_BY_TYPE = {
  "dist_tag": [
    "package",
    "@scoped/package",
  ],
  "npm": [
    "@scoped/package@1.0.0",
    "@scoped/package@1.0.0-beta.1",
    "@scoped/package@1.0.0-beta.1+build.123",
    "package@1.0.0",
    "package@1.0.0-beta.1",
    "package@1.0.0-beta.1+build.123",
  ],
  "tarball": [
    "./path/to/tarball.tgz",
    "file:./path/to/tarball.tgz",
    "http://localhost:5000/no-deps/-/no-deps-2.0.0.tgz",
    "https://gitlab.com/inkscape/inkscape/-/archive/INKSCAPE_1_4/inkscape-INKSCAPE_1_4.tar.gz",
    "https://registry.npmjs.org/no-deps/-/no-deps-2.0.0.tgz",
  ],
  "folder": [
    "file:./path/to/folder",
  ],
  "git": [
    "bitbucket.com:dylan-conway/public-install-test",
    "bitbucket.org:dylan-conway/public-install-test",
    "bitbucket:dylan-conway/public-install-test",
    "git@bitbucket.org:dylan-conway/public-install-test",
    "git@github.com:dylan-conway/public-install-test",
    "gitlab.com:dylan-conway/public-install-test",
    "gitlab:dylan-conway/public-install-test",
    "https://github.com/dylan-conway/public-install-test.git#semver:^1.0.0",
  ],
  "github": [
    "foo/bar",
    "github:dylan-conway/public-install-test",
    "https://github.com/Jarred-Sumner/test-tarball-url.tgz",
    "https://github.com/dylan-conway/public-install-test",
    "https://github.com/dylan-conway/public-install-test.git",
  ],
};


const ALL_TEST_DEPENDENCIES = Object.values(TEST_DEPENDENCIES_BY_TYPE).flat();

test.each(ALL_TEST_DEPENDENCIES)("npa %s", dep => {
  expect(npa(dep)).toMatchSnapshot();
});

describe("Dependency resolution", () => {
  describe("Resolves to the correct type", () => {
    const testSeries = Object.entries(TEST_DEPENDENCIES_BY_TYPE)
      .flatMap(([key, depStrs]) => depStrs.map(dep => [dep, key]));

    test.each(testSeries)("%s resolves as %s", (depStr, expectedType) => {
      expect(npa(depStr).version.type).toBe(expectedType);
    });
  });
});

const pkgJsonLike = [
  ["foo", "1.2.3"],
  ["foo", "latest"],
  ["foo", "workspace:*"],
  ["foo", "workspace:^1.0.0"],
  ["foo", "workspace:1.0.0"],
  ["foo", "workspace:1.0.0-beta.1"],
  ["foo", "workspace:1.0.0-beta.1+build.123"],
  ["foo", "workspace:1.0.0-beta.1+build.123"],
  ["foo", "workspace:1.0.0-beta.1+build.123"],
  ["bar", "^1.0.0"],
  ["bar", "~1.0.0"],
  ["bar", "> 1.0.0 < 2.0.0"],
  ["bar", "1.0.0 - 2.0.0"],
];

test.each(pkgJsonLike)('dependencies: {"%s": "%s"}', (name, version) => {
  expect(npa(name, version)).toMatchSnapshot();
});

test("bad", () => {
  expect(() => npa("-123!}{P}{!P#$s")).toThrow();
});
