import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

// The pairs live in a WTF::Vector, which aborts the process when a growth step
// asks for a capacity over its INT32_MAX-byte cap. Bun throws a RangeError at
// the last size the Vector can hold instead. The limit follows the synthetic
// allocation limit (1 MiB is its floor), so 65536 pairs of 16 bytes reach it.
describe("entry count limit", () => {
  const LIMIT = 1024 * 1024;
  const MAX = LIMIT / 16;
  const tooMany = `URLSearchParams cannot hold more than ${MAX} entries.`;
  // Each child parses 65536 pairs, 3 to 7 s in a debug build, past the 5 s default.
  // The work cannot shrink: 1 MiB is the smallest synthetic limit.
  const TIMEOUT = 60_000;
  const preamble = `
    import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
    setSyntheticAllocationLimitForTesting(${LIMIT});
    const MAX = ${MAX};
    const pairs = n => Buffer.alloc(2 * n, "a&").toString();
    const threw = fn => {
      try {
        fn();
        return null;
      } catch (e) {
        return e instanceof RangeError ? e.message : String(e);
      }
    };
    const out = {};
  `;

  async function run(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${preamble}\n${script}\nconsole.log(JSON.stringify(out));`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  it.concurrent(
    "parses a string with exactly the limit, then append and set throw",
    async () => {
      const out = await run(`
        const params = new URLSearchParams(pairs(MAX));
        out.size = params.size;
        out.append = threw(() => params.append("b", "1"));
        out.setNew = threw(() => params.set("b", "1"));
        out.setExisting = threw(() => params.set("a", "1"));
        out.sizeAfter = params.size;
        out.first = params.get("a");
        out.has = params.has("b");
      `);
      expect(out).toEqual({
        size: MAX,
        append: tooMany,
        setNew: tooMany,
        setExisting: null,
        sizeAfter: 1,
        first: "1",
        has: false,
      });
    },
    TIMEOUT,
  );

  it.concurrent(
    "the string constructor throws one pair past the limit",
    async () => {
      const out = await run(`
        out.string = threw(() => new URLSearchParams("?" + pairs(MAX + 1)));
        out.record = new URLSearchParams({ a: "1", b: "2" }).size;
      `);
      expect(out).toEqual({ string: tooMany, record: 2 });
    },
    TIMEOUT,
  );

  it.concurrent(
    "the sequence constructor throws one pair past the limit",
    async () => {
      const out = await run(`
        const list = Array.from({ length: MAX + 1 }, () => ["a", ""]);
        out.sequence = threw(() => new URLSearchParams(list));
        out.size = new URLSearchParams(list.slice(1)).size;
      `);
      expect(out).toEqual({ sequence: tooMany, size: MAX });
    },
    TIMEOUT,
  );

  it.concurrent(
    "throws from append once the limit is reached",
    async () => {
      const out = await run(`
        const params = new URLSearchParams();
        for (let i = 0; i < MAX; i++) params.append("a", "");
        out.size = params.size;
        out.append = threw(() => params.append("a", ""));
        out.sizeAfter = params.size;
        params.delete("a");
        out.appendAfterDelete = threw(() => params.append("b", "1"));
        out.string = params.toString();
      `);
      expect(out).toEqual({ size: MAX, append: tooMany, sizeAfter: MAX, appendAfterDelete: null, string: "b=1" });
    },
    TIMEOUT,
  );

  it.concurrent(
    "url.searchParams throws when the query has too many pairs",
    async () => {
      const out = await run(`
        const url = new URL("http://example.com/?" + pairs(MAX + 1));
        out.searchLength = url.search.length;
        out.searchParams = threw(() => url.searchParams);
        out.searchParamsAgain = threw(() => url.searchParams);
        url.search = "a=1";
        out.size = url.searchParams.size;
      `);
      expect(out).toEqual({
        searchLength: 1 + 2 * (MAX + 1),
        searchParams: tooMany,
        searchParamsAgain: tooMany,
        size: 1,
      });
    },
    TIMEOUT,
  );

  it.concurrent(
    "url.href throws when the new query has too many pairs",
    async () => {
      const out = await run(`
        const url = new URL("http://example.com/?a=1");
        const params = url.searchParams;
        out.href = threw(() => { url.href = "http://example.com/?" + pairs(MAX + 1); });
        out.searchLength = url.search.length;
        out.sizeAfterFailedHref = params.size;
        url.href = "http://example.com/?b=2";
        out.getAfterHref = params.get("b");
      `);
      expect(out).toEqual({
        href: tooMany,
        searchLength: 1 + 2 * (MAX + 1),
        sizeAfterFailedHref: 0,
        getAfterHref: "2",
      });
    },
    TIMEOUT,
  );
});
