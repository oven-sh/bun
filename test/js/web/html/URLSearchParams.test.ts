import { describe, expect, it } from "bun:test";

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

it(".has second argument", () => {
  const params = new URLSearchParams("a=1&a=2&b=3");
  expect(params.has("a", 1)).toBe(true);
  expect(params.has("a", 2)).toBe(true);
  expect(params.has("a", 3)).toBe(false);
  expect(params.has("b", 3)).toBe(true);
  expect(params.has("b", 4)).toBe(false);
});
