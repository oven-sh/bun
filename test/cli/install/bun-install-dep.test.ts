import { npa } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const bitbucket = [
  "bitbucket:dylan-conway/public-install-test",
  "bitbucket.org:dylan-conway/public-install-test",
  "bitbucket.com:dylan-conway/public-install-test",
  "git@bitbucket.org:dylan-conway/public-install-test",
];

const tarball_remote = [
  "http://localhost:5000/no-deps/-/no-deps-2.0.0.tgz",
  "https://registry.npmjs.org/no-deps/-/no-deps-2.0.0.tgz",
];

const local_tarball = ["file:./path/to/tarball.tgz", "./path/to/tarball.tgz"];
const github = ["foo/bar"];
const folder = ["file:./path/to/folder"];

const gitlab = ["gitlab:dylan-conway/public-install-test", "gitlab.com:dylan-conway/public-install-test"];

const all = [
  "@scoped/package",
  "@scoped/package@1.0.0",
  "@scoped/package@1.0.0-beta.1",
  "@scoped/package@1.0.0-beta.1+build.123",
  "package",
  "package@1.0.0",
  "package@1.0.0-beta.1",
  "package@1.0.0-beta.1+build.123",
  ...bitbucket,
  ...github,
  ...gitlab,
  ...tarball_remote,
  ...local_tarball,
  ...github,
  "github:dylan-conway/public-install-test",
  "git@github.com:dylan-conway/public-install-test",
  "https://github.com/dylan-conway/public-install-test",
  "https://github.com/dylan-conway/public-install-test.git",
  "https://github.com/dylan-conway/public-install-test.git#semver:^1.0.0",
];

test.each(all)("npa %s", dep => {
  expect(npa(dep)).toMatchSnapshot();
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
