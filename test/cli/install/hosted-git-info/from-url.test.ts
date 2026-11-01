import { hostedGitInfo } from "bun:internal-for-testing";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { invalidGitUrls, validGitUrls } from "./cases";

describe("fromUrl", () => {
  // The expected objects are what hosted-git-info 9.0.0 returns.
  describe("shortcuts with an empty user, project and committish", () => {
    // An assert-enabled build aborted on these shortcuts. `bun install` runs the same parser in a
    // child process, so that an abort fails this hook and not the process that runs the tests.
    beforeAll(async () => {
      using dir = tempDir("from-url-empty-shortcut", {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", overrides: { zz: "github:" } }),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "ignore",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      if (exitCode !== 0) expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    const empty = { user: null, project: "", committish: null, default: "shortcut" };
    const github = { type: "github", domain: "github.com", ...empty };
    const gitlab = { type: "gitlab", domain: "gitlab.com", ...empty };

    it.each([
      ["github:", github],
      ["gitlab:", gitlab],
      ["bitbucket:", { type: "bitbucket", domain: "bitbucket.org", ...empty }],
      ["gist:", { type: "gist", domain: "gist.github.com", ...empty }],
      ["sourcehut:", { type: "sourcehut", domain: "git.sr.ht", ...empty }],
      ["github:.git", github],
      ["github:/", github],
      ["github://", github],
      ["github:#", github],
      ["github:?x", github],
      ["github:@", github],
      ["github:a@", github],
      ["gitlab:.git", gitlab],
    ])("parses %s", (url, expected) => {
      expect(hostedGitInfo.fromUrl(url)).toEqual(expected);
    });
  });

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

  describe("user/project extractors", () => {
    it.each([
      "https://bitbucket.org/foo/bar/get/archive.tar.gz",
      "https://gist.github.com/foo/feedbeef/raw/fix%2Fbug/",
      "https://git.sr.ht/~foo/bar/archive/HEAD.tar.gz",
      "https://bitbucket.org/foo",
      "https://git.sr.ht/~foo",
      "https://gist.github.com/",
      "https://bitbucket.org//bar",
      "https://git.sr.ht//bar",
    ])("%s is not a hosted git url", url => {
      expect(hostedGitInfo.fromUrl(url)).toBeNull();
    });

    it.each([
      ["https://bitbucket.org/foo/bar/raw", { type: "bitbucket", user: "foo", project: "bar" }],
      ["https://bitbucket.org/foo/bar/archive", { type: "bitbucket", user: "foo", project: "bar" }],
      ["https://gist.github.com/foo/feedbeef/get", { type: "gist", user: "foo", project: "feedbeef" }],
      ["https://gist.github.com/foo/feedbeef/archive", { type: "gist", user: "foo", project: "feedbeef" }],
      ["https://git.sr.ht/~foo/bar/get", { type: "sourcehut", user: "~foo", project: "bar" }],
      ["https://git.sr.ht/~foo/bar/raw", { type: "sourcehut", user: "~foo", project: "bar" }],
    ])("%s parses despite another host's aux segment", (url, expected) => {
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
      "%s has an undecodable project",
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
