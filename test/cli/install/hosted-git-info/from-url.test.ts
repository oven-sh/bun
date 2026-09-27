import { hostedGitInfo } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { invalidGitUrls, validGitUrls } from "./cases";

describe("fromUrl", () => {
  // The expected objects are what hosted-git-info 9.0.0 returns. The child process is there
  // because a failed assertion in the parser aborts the process that runs it.
  it("parses shortcuts with an empty user, project and committish", async () => {
    const empty = { user: null, project: "", committish: null, default: "shortcut" };
    const github = { type: "github", domain: "github.com", ...empty };
    const gitlab = { type: "gitlab", domain: "gitlab.com", ...empty };
    const expected = [
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
    ] as const;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { hostedGitInfo } from "bun:internal-for-testing";
         console.log(JSON.stringify(process.argv.slice(1).map(url => [url, hostedGitInfo.fromUrl(url)])));`,
        ...expected.map(([url]) => url),
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
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
