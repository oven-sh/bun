import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { totalmem } from "node:os";

describe("URLSearchParams", () => {
  it("does not crash when calling .toJSON() on a URLSearchParams object with a large number of properties", () => {
    const props = {
      "id": "1296269",
      "node_id": "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
      "name": "Hello-World",
      "full_name": "octocat/Hello-World",
      "owner": "[object Object]",
      "private": "false",
      "html_url": "https://github.com/octocat/Hello-World",
      "description": "This your first repo!",
      "fork": "false",
      "url": "https://api.github.com/repos/octocat/Hello-World",
      "archive_url": "https://api.github.com/repos/octocat/Hello-World/{archive_format}{/ref}",
      "assignees_url": "https://api.github.com/repos/octocat/Hello-World/assignees{/user}",
      "blobs_url": "https://api.github.com/repos/octocat/Hello-World/git/blobs{/sha}",
      "branches_url": "https://api.github.com/repos/octocat/Hello-World/branches{/branch}",
      "collaborators_url": "https://api.github.com/repos/octocat/Hello-World/collaborators{/collaborator}",
      "comments_url": "https://api.github.com/repos/octocat/Hello-World/comments{/number}",
      "commits_url": "https://api.github.com/repos/octocat/Hello-World/commits{/sha}",
      "compare_url": "https://api.github.com/repos/octocat/Hello-World/compare/{base}...{head}",
      "contents_url": "https://api.github.com/repos/octocat/Hello-World/contents/{+path}",
      "contributors_url": "https://api.github.com/repos/octocat/Hello-World/contributors",
      "deployments_url": "https://api.github.com/repos/octocat/Hello-World/deployments",
      "downloads_url": "https://api.github.com/repos/octocat/Hello-World/downloads",
      "events_url": "https://api.github.com/repos/octocat/Hello-World/events",
      "forks_url": "https://api.github.com/repos/octocat/Hello-World/forks",
      "git_commits_url": "https://api.github.com/repos/octocat/Hello-World/git/commits{/sha}",
      "git_refs_url": "https://api.github.com/repos/octocat/Hello-World/git/refs{/sha}",
      "git_tags_url": "https://api.github.com/repos/octocat/Hello-World/git/tags{/sha}",
      "git_url": "git:github.com/octocat/Hello-World.git",
      "issue_comment_url": "https://api.github.com/repos/octocat/Hello-World/issues/comments{/number}",
      "issue_events_url": "https://api.github.com/repos/octocat/Hello-World/issues/events{/number}",
      "issues_url": "https://api.github.com/repos/octocat/Hello-World/issues{/number}",
      "keys_url": "https://api.github.com/repos/octocat/Hello-World/keys{/key_id}",
      "labels_url": "https://api.github.com/repos/octocat/Hello-World/labels{/name}",
      "languages_url": "https://api.github.com/repos/octocat/Hello-World/languages",
      "merges_url": "https://api.github.com/repos/octocat/Hello-World/merges",
      "milestones_url": "https://api.github.com/repos/octocat/Hello-World/milestones{/number}",
      "notifications_url": "https://api.github.com/repos/octocat/Hello-World/notifications{?since,all,participating}",
      "pulls_url": "https://api.github.com/repos/octocat/Hello-World/pulls{/number}",
      "releases_url": "https://api.github.com/repos/octocat/Hello-World/releases{/id}",
      "ssh_url": "git@github.com:octocat/Hello-World.git",
      "stargazers_url": "https://api.github.com/repos/octocat/Hello-World/stargazers",
      "statuses_url": "https://api.github.com/repos/octocat/Hello-World/statuses/{sha}",
      "subscribers_url": "https://api.github.com/repos/octocat/Hello-World/subscribers",
      "subscription_url": "https://api.github.com/repos/octocat/Hello-World/subscription",
      "tags_url": "https://api.github.com/repos/octocat/Hello-World/tags",
      "teams_url": "https://api.github.com/repos/octocat/Hello-World/teams",
      "trees_url": "https://api.github.com/repos/octocat/Hello-World/git/trees{/sha}",
      "clone_url": "https://github.com/octocat/Hello-World.git",
      "mirror_url": "git:git.example.com/octocat/Hello-World",
      "hooks_url": "https://api.github.com/repos/octocat/Hello-World/hooks",
      "svn_url": "https://svn.github.com/octocat/Hello-World",
      "homepage": "https://github.com",
      "language": "null",
      "forks_count": "9",
      "stargazers_count": "80",
      "watchers_count": "80",
      "size": "108",
      "default_branch": "master",
      "open_issues_count": "0",
      "is_template": "false",
      "topics": "octocat,atom,electron,api",
      "has_issues": "true",
      "has_projects": "true",
      "has_wiki": "true",
      "has_pages": "false",
      "has_downloads": "true",
      "has_discussions": "false",
      "archived": "false",
      "disabled": "false",
      "visibility": "public",
      "pushed_at": "2011-01-26T19:06:43Z",
      "created_at": "2011-01-26T19:01:12Z",
      "updated_at": "2011-01-26T19:14:43Z",
      "permissions": "[object Object]",
      "security_and_analysis": "[object Object]",
    };
    var params = new URLSearchParams();
    for (const key in props) {
      params.set(key, props[key as keyof typeof props]);
    }

    // @ts-expect-error
    expect(params.toJSON()).toEqual(props);

    expect(Array.from(params.keys())).toHaveLength(params.size);
  });

  describe("non-standard extensions", () => {
    it("should support .length", () => {
      const params = new URLSearchParams();
      params.append("foo", "bar");
      params.append("foo", "boop");
      params.append("bar", "baz");
      // @ts-ignore
      expect(params.length).toBe(3);
      params.delete("foo");
      // @ts-ignore
      expect(params.length).toBe(1);
      params.append("foo", "bar");
      // @ts-ignore
      expect(params.length).toBe(2);
      params.delete("foo");
      params.delete("foo");
      // @ts-ignore
      expect(params.length).toBe(1);
      params.delete("bar");
      // @ts-ignore
      expect(params.length).toBe(0);
    });

    it("should support .toJSON", () => {
      const params = new URLSearchParams();
      params.append("foo", "bar");
      params.append("foo", "boop");
      params.append("bar", "baz");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        foo: ["bar", "boop"],
        bar: "baz",
      });
      expect(JSON.parse(JSON.stringify(params))).toEqual({
        foo: ["bar", "boop"],
        bar: "baz",
      });
      expect(Bun.inspect(params)).toBe(
        "URLSearchParams {" + "\n" + '  "foo": [ "bar", "boop" ],' + "\n" + '  "bar": "baz",' + "\n" + "}",
      );
      params.delete("foo");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        bar: "baz",
      });
      params.append("foo", "bar");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        foo: "bar",
        bar: "baz",
      });
      params.delete("foo");
      params.delete("foo");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        bar: "baz",
      });
      params.delete("bar");
      // @ts-ignore
      expect(params.toJSON()).toEqual({});

      expect(JSON.stringify(params)).toBe("{}");
    });

    it("should handle numeric string keys in .toJSON", () => {
      const params = new URLSearchParams();
      params.set("39208", "updated");
      // @ts-ignore
      expect(params.toJSON()).toEqual({ "39208": "updated" });
    });

    it("should handle various numeric keys in .toJSON", () => {
      const params = new URLSearchParams();
      params.set("0", "zero");
      params.set("100", "hundred");
      params.set("99999", "large");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        "0": "zero",
        "100": "hundred",
        "99999": "large",
      });
    });

    it("should handle mixed numeric and non-numeric keys in .toJSON", () => {
      const params = new URLSearchParams();
      params.set("name", "John");
      params.set("123", "numeric");
      params.set("age", "30");
      params.set("456", "another");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        "name": "John",
        "123": "numeric",
        "age": "30",
        "456": "another",
      });
    });

    it("should handle duplicate numeric keys in .toJSON", () => {
      const params = new URLSearchParams();
      params.append("100", "first");
      params.append("100", "second");
      params.append("name", "test");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        "100": ["first", "second"],
        "name": "test",
      });
    });

    it("toJSON with extra arguments should not crash", () => {
      const params = new URLSearchParams();
      params.set("39208", "updated");
      // toJSON should ignore extra arguments
      // @ts-ignore - intentionally passing extra args
      const result = params.toJSON({}, URLSearchParams, {}, "updated");
      expect(result).toEqual({ "39208": "updated" });
    });
  });
});

it("size property should be configurable (issue #9251)", () => {
  const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
  expect(descriptor).toBeDefined();
  expect(descriptor!.configurable).toBe(true);
  expect(descriptor!.enumerable).toBe(true);
});

it(".delete second argument", () => {
  const params = new URLSearchParams("a=1&a=2&b=3");
  params.delete("a", 1);
  params.delete("b", undefined);
  expect(params + "").toBe("a=2");
});

describe("USVString conversion of lone surrogates", () => {
  const loneHigh = "a\uD800b";
  const loneLow = "a\uDC00b";
  const replaced = "a\uFFFDb";

  it("get/getAll/has find an entry appended under a lone surrogate name", () => {
    const params = new URLSearchParams();
    params.append(loneHigh, "1");
    params.append(loneHigh, "2");

    expect([...params]).toEqual([
      [replaced, "1"],
      [replaced, "2"],
    ]);
    expect(params.has(loneHigh)).toBe(true);
    expect(params.get(loneHigh)).toBe("1");
    expect(params.getAll(loneHigh)).toEqual(["1", "2"]);

    // the converted spelling names the same entry
    expect(params.has(replaced)).toBe(true);
    expect(params.get(replaced)).toBe("1");
    expect(params.getAll(replaced)).toEqual(["1", "2"]);
  });

  it("lone high and lone low surrogates both convert to U+FFFD", () => {
    const params = new URLSearchParams();
    params.append(loneLow, "low");
    expect(params.get(loneLow)).toBe("low");
    expect(params.get(loneHigh)).toBe("low");
    expect(params.has(loneHigh)).toBe(true);
  });

  it("converts the value argument of .has()", () => {
    const params = new URLSearchParams();
    params.append("k", loneHigh);
    expect(params.get("k")).toBe(replaced);
    expect(params.has("k", loneHigh)).toBe(true);
    expect(params.has("k", replaced)).toBe(true);
  });

  it(".set() and .delete() address the converted entry", () => {
    const params = new URLSearchParams();
    params.append(loneHigh, "1");
    params.set(loneHigh, "2");
    expect([...params]).toEqual([[replaced, "2"]]);
    params.delete(loneHigh);
    expect(params.size).toBe(0);
  });

  it("serializes and round-trips the converted name", () => {
    const params = new URLSearchParams();
    params.append(loneHigh, "1");
    expect(params.toString()).toBe("a%EF%BF%BDb=1");
    expect(new URLSearchParams(params.toString()).get(loneHigh)).toBe("1");

    const url = new URL("https://example.com/");
    url.searchParams.append(loneHigh, "1");
    expect(url.search).toBe("?a%EF%BF%BDb=1");
    expect(url.searchParams.get(loneHigh)).toBe("1");
  });

  it("leaves valid surrogate pairs alone", () => {
    const params = new URLSearchParams();
    params.append("\u{1F600}", "emoji");
    expect(params.has("\u{1F600}")).toBe(true);
    expect(params.get("\u{1F600}")).toBe("emoji");
    expect(params.getAll("\u{1F600}")).toEqual(["emoji"]);
    expect(params.get("\uFFFD")).toBeNull();
    expect(params.toString()).toBe("%F0%9F%98%80=emoji");
  });
});

it(".has second argument", () => {
  const params = new URLSearchParams("a=1&a=2&b=3");
  expect(params.has("a", 1)).toBe(true);
  expect(params.has("a", 2)).toBe(true);
  expect(params.has("a", 3)).toBe(false);
  expect(params.has("b", 3)).toBe(true);
  expect(params.has("b", 4)).toBe(false);
});

// WTF's URL-encoded form parser RELEASE_ASSERTs when the UTF-8 form of a name or
// value does not fit a WTF::Vector (1 GiB - 1 bytes), so Bun rejects such input
// with a RangeError before parsing. The limit follows the synthetic allocation
// limit so that every entry point can be exercised with megabyte inputs.
describe("URL-encoded input longer than the string limit", () => {
  const LIMIT = 1024 * 1024;
  const tooLong = (received: number) =>
    `RangeError: A URL-encoded name or value must not be longer than ${LIMIT} bytes as UTF-8. Received ${received} bytes.`;

  it("throws a RangeError from every parser entry point, at the UTF-8 byte limit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
        setSyntheticAllocationLimitForTesting(${LIMIT});
        const out = {};
        const attempt = (label, f) => {
          try {
            out[label] = f();
          } catch (e) {
            out[label] = e.constructor.name + ": " + e.message;
          }
        };
        const ascii = n => Buffer.alloc(n, "a").toString();
        // One Latin-1 character is 2 UTF-8 bytes, one UTF-16 unit of "€" is 3.
        const latin1 = n => Buffer.alloc(n * 2, "é").toString();
        const utf16 = n => Buffer.alloc(n * 3, "€").toString();

        attempt("ascii at limit", () => new URLSearchParams(ascii(${LIMIT})).size);
        attempt("ascii past limit", () => new URLSearchParams(ascii(${LIMIT} + 1)).size);
        attempt("leading ? is not counted", () => new URLSearchParams("?" + ascii(${LIMIT})).size);
        attempt("latin1 at limit", () => new URLSearchParams(latin1(${LIMIT / 2})).size);
        attempt("latin1 past limit", () => new URLSearchParams(latin1(${LIMIT / 2} + 1)).size);
        attempt("utf16 at limit", () => new URLSearchParams(utf16(349525)).size);
        attempt("utf16 past limit", () => new URLSearchParams(utf16(349526)).size);
        // WTF converts the encoded text to UTF-8 before it percent-decodes, so the
        // encoded length is the one that counts.
        attempt("percent-encoded past limit", () => new URLSearchParams(Buffer.alloc(${LIMIT} + 2, "%41").toString()).size);
        // The limit applies to one name or value, not to the whole input.
        attempt("two names at limit", () => new URLSearchParams(ascii(${LIMIT}) + "&" + ascii(${LIMIT})).size);
        attempt("name and value at limit", () => new URLSearchParams(ascii(${LIMIT}) + "=" + ascii(${LIMIT})).size);
        attempt("one value past limit among pairs", () => new URLSearchParams("a=1&b=" + ascii(${LIMIT} + 1) + "&c=2").size);
        attempt("url.searchParams at limit", () => new URL("http://x/?" + ascii(${LIMIT})).searchParams.size);
        attempt("url.searchParams past limit", () => new URL("http://x/?" + ascii(${LIMIT} + 1)).searchParams.size);

        const url = new URL("http://x/?a=1");
        const params = url.searchParams;
        attempt("url.href= past limit", () => { url.href = "http://x/?" + ascii(${LIMIT} + 1); });
        out["url.href= past limit leaves the url set and the params empty"] = {
          search: url.search.length,
          size: params.size,
          sameObject: url.searchParams === params,
        };
        attempt("url.href= at limit", () => { url.href = "http://x/?" + ascii(${LIMIT}); return params.size; });
        // Component setters return void, so the params only empty out.
        attempt("url.search= past limit", () => { url.search = ascii(${LIMIT} + 1); return params.size; });
        console.log(JSON.stringify(out));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Keep stderr and the exit code in the diff when the child aborts before it prints.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toEqual({
      results: {
        "ascii at limit": 1,
        "ascii past limit": tooLong(LIMIT + 1),
        "leading ? is not counted": 1,
        "latin1 at limit": 1,
        "latin1 past limit": tooLong(LIMIT + 2),
        "utf16 at limit": 1,
        "utf16 past limit": tooLong(LIMIT + 2),
        "percent-encoded past limit": tooLong(LIMIT + 2),
        "two names at limit": 2,
        "name and value at limit": 1,
        "one value past limit among pairs": tooLong(LIMIT + 1),
        "url.searchParams at limit": 1,
        "url.searchParams past limit": tooLong(LIMIT + 1),
        "url.href= past limit": tooLong(LIMIT + 1),
        "url.href= past limit leaves the url set and the params empty": {
          search: LIMIT + 2,
          size: 0,
          sameObject: true,
        },
        "url.href= at limit": 1,
        "url.search= past limit": 0,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // The real limit needs a 1 GiB string, so this runs only on large machines.
  it.skipIf(totalmem() < 10 * 1024 ** 3)("throws a RangeError at the real limit instead of crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const input = Buffer.alloc(2 ** 30, "a").toString();
        try {
          new URLSearchParams(input);
          console.log("no error");
        } catch (e) {
          console.log(e.constructor.name + ": " + e.message);
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "RangeError: A URL-encoded name or value must not be longer than 1073741823 bytes as UTF-8. Received 1073741824 bytes.\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
