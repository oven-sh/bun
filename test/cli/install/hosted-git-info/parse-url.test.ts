/**
 * Mimics https://github.com/npm/hosted-git-info/blob/main/test/parse-url.js
 */
import { hostedGitInfo } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";

const okCases = [
  // These come straight out of the hosted-git-info tests
  "git+ssh://git@abc:frontend/utils.git#6d45447e0c5eb6cd2e3edf05a8c5a9bb81950c79",
  // These are custom cases added for Bun
  "ssh://:password@bitbucket.org:foo/bar.git",
  "git@bitbucket.org:foo/bar",
  "gist:user:password@/feedbeef#branch",
  "github:foo/bar#branch with space",
];

// The scp-style `host:path` -> `host/path` rewrite only applies to input that does not
// already parse as a URL, so a port survives while a path starting with a digit is still
// rewritten (corrected URLs are re-emitted with the git+ssh: protocol).
const hrefCases = [
  ["git+ssh://git@example.com:52626/user/repo.git#v1.0.0", "git+ssh://git@example.com:52626/user/repo.git#v1.0.0"],
  ["ssh://git@example.com:52626/user/repo.git", "ssh://git@example.com:52626/user/repo.git"],
  ["ssh://git@example.com:1user/repo.git", "git+ssh://git@example.com/1user/repo.git"],
  ["git@example.com:1user/repo.git", "git+ssh://git@example.com/1user/repo.git"],
];

describe("parseUrl", () => {
  it.each(okCases)("parses %s", url => {
    expect(hostedGitInfo.parseUrl(url)).not.toBeNull();
  });

  it.each(hrefCases)("parses %s as %s", (url, href) => {
    expect(hostedGitInfo.parseUrl(url)).toBe(href);
  });
});
