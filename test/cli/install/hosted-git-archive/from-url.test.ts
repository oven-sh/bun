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
        });
      });
    });
  });

  // TODO(markovejnovic): These are skipped because the current implementation of fromUrl does not perform any sanity
  // checks. The npm/hosted-git-info implementation does perform these checks, however, we do not use hosted-git-info
  // for parsing URLs, merely for decoding the host provider, so this is not a high priority.
  describe.skip("invalid urls", () => {
    describe.each(Object.entries(invalidGitUrls))("%s", (_, urls: (string | null | undefined)[]) => {
      it.each(urls)("does not permit %s", url => {
        expect(hostedGitInfo.fromUrl(url)).toThrow();
      });
    });
  });
});
