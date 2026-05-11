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

describe("parseUrl", () => {
  it.each(okCases)("parses %s", url => {
    expect(hostedGitInfo.parseUrl(url)).not.toBeNull();
  });
});
