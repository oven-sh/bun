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
