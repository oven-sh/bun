import { hostedGitInfo } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { invalidGitUrls, validGitUrls } from "./cases";

describe("fromUrl", () => {
  describe("valid urls", () => {
    describe.each(Object.entries(validGitUrls))("%s", (_, urlset: object) => {
      it.each(Object.entries(urlset))("parses %s", (url, expected) => {
        expect(hostedGitInfo.fromUrl(url)).toMatchObject({
          ...(expected.type && { type: expected.type }),
          ...(expected.domain && { domain: expected.domain }),
          ...(expected.user && { user: expected.user }),
          ...(expected.project && { project: expected.project }),
          ...(expected.committish && { committish: expected.committish }),
          ...(expected.default && { default: expected.default }),
        });
      });
    });
  });

  // bitbucket, gist, and sourcehut share the `/user/project[/aux]` extractor;
  // these pin the per-host differences it is parameterized on.
  describe("user/project extractors", () => {
    it.each([
      // tarball-ish aux segment rejected per host
      "https://bitbucket.org/foo/bar/get/archive.tar.gz",
      "https://gist.github.com/foo/feedbeef/raw/fix%2Fbug/",
      "https://git.sr.ht/~foo/bar/archive/HEAD.tar.gz",
      // missing project (gist: missing both user and project)
      "https://bitbucket.org/foo",
      "https://git.sr.ht/~foo",
      "https://gist.github.com/",
      // user is required everywhere except gist
      "https://bitbucket.org//bar",
      "https://git.sr.ht//bar",
    ])("%s is not a hosted git url", url => {
      expect(hostedGitInfo.fromUrl(url)).toBeNull();
    });

    // The rejected aux segment is per host: another host's segment parses.
    it.each([
      ["https://bitbucket.org/foo/bar/raw", { type: "bitbucket", user: "foo", project: "bar" }],
      ["https://bitbucket.org/foo/bar/archive", { type: "bitbucket", user: "foo", project: "bar" }],
      ["https://gist.github.com/foo/feedbeef/get", { type: "gist", user: "foo", project: "feedbeef" }],
      ["https://gist.github.com/foo/feedbeef/archive", { type: "gist", user: "foo", project: "feedbeef" }],
      ["https://git.sr.ht/~foo/bar/get", { type: "sourcehut", user: "~foo", project: "bar" }],
      ["https://git.sr.ht/~foo/bar/raw", { type: "sourcehut", user: "~foo", project: "bar" }],
    ])("%s parses despite the aux segment", (url, expected) => {
      expect(hostedGitInfo.fromUrl(url)).toMatchObject(expected);
    });

    it.each([
      ["https://gist.github.com/feedbeef", null],
      ["https://gist.github.com//feedbeef", null],
      ["https://gist.github.com/foo/feedbeef", "foo"],
    ])("gist %s has user %p", (url, user) => {
      expect(hostedGitInfo.fromUrl(url)).toMatchObject({ type: "gist", user, project: "feedbeef" });
    });

    it.each(["https://gist.github.com/foo/bar%0N", "https://git.sr.ht/~foo/bar%0N"])(
      "%s with an undecodable project is not a hosted git url",
      url => {
        expect(hostedGitInfo.fromUrl(url)).toBeNull();
      },
    );

    it("bitbucket rejects an undecodable project as an invalid url", () => {
      expect(() => hostedGitInfo.fromUrl("https://bitbucket.org/foo/bar%0N")).toThrow("Invalid Git URL: InvalidURL");
    });
  });

  // TODO(markovejnovic): Unskip these tests.
  describe.skip("invalid urls", () => {
    describe.each(Object.entries(invalidGitUrls))("%s", (_, urls: (string | null | undefined)[]) => {
      it.each(urls)("does not permit %s", url => {
        expect(() => {
          hostedGitInfo.fromUrl(url);
        }).toThrow();
      });
    });
  });
});
