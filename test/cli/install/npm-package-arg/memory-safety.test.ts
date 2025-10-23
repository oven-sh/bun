import { Npa } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

describe("npm-package-arg memory safety", () => {
  describe("fromAlias error paths", () => {
    test("handles nested alias error without leaking", () => {
      // This should trigger error.NestedAlias
      // Before fix: leaked sub_spec allocation
      expect(() => {
        Npa.npa("foo@npm:bar@npm:baz", "/test/path");
      }).toThrow();
    });

    test("handles non-registry alias without leaking", () => {
      // This should trigger error.NotAliasingRegistry
      // Before fix: leaked sub_spec allocation
      expect(() => {
        Npa.npa("foo@npm:github:user/repo", "/test/path");
      }).toThrow();
    });
  });

  describe("fromGitSpec error paths", () => {
    test("handles valid git spec without crashing", () => {
      // This should succeed and properly clean up
      const result = Npa.npa("github:user/repo", "/test/path");
      expect(result.type).toBe("git");
      expect(result.hosted).toBeDefined();
    });

    test("handles git spec with committish", () => {
      // Tests that git_attrs is properly managed
      // Before fix: if internal allocation failed, hosted would leak
      const result = Npa.npa("github:user/repo#v1.0.0", "/test/path");
      expect(result.type).toBe("git");
      expect(result.gitCommittish).toBe("v1.0.0");
    });

    test("handles git spec with semver range", () => {
      // Tests GitAttrs.fromCommittish with semver parsing
      // This also exercises the double-free fix (Bug #3)
      const result = Npa.npa("github:user/repo#semver:^1.0.0", "/test/path");
      expect(result.type).toBe("git");
      expect(result.gitRange).toBe("^1.0.0");
    });

    test("handles git spec with path", () => {
      // Tests GitAttrs.fromCommittish with subdir
      const result = Npa.npa("github:user/repo#path:packages/foo", "/test/path");
      expect(result.type).toBe("git");
      expect(result.gitSubdir).toBe("/packages/foo");
    });

    test("handles git spec with multiple attributes", () => {
      // Tests GitAttrs.fromCommittish with multiple parts
      const result = Npa.npa("github:user/repo#v1.0.0::path:packages/foo", "/test/path");
      expect(result.type).toBe("git");
      expect(result.gitCommittish).toBe("v1.0.0");
      expect(result.gitSubdir).toBe("/packages/foo");
    });
  });

  describe("GitAttrs.fromCommittish edge cases", () => {
    test("handles invalid percent encoding in semver range", () => {
      // This should trigger the error path in PercentEncoding.decode
      // Before fix: double-free when error returned
      // The percent encoding needs to be malformed to trigger decode error
      expect(() => {
        Npa.npa("github:user/repo#semver:%XX", "/test/path");
      }).toThrow();
    });

    test("handles duplicate committish attributes", () => {
      // Should trigger error.InvalidCommittish
      expect(() => {
        Npa.npa("github:user/repo#v1.0.0::v2.0.0", "/test/path");
      }).toThrow();
    });

    test("handles committish and semver conflict", () => {
      // Should trigger error.InvalidCommittish (can't have both)
      expect(() => {
        Npa.npa("github:user/repo#v1.0.0::semver:^1.0.0", "/test/path");
      }).toThrow();
    });

    test("handles duplicate subdir", () => {
      // Should trigger error.InvalidCommittish
      expect(() => {
        Npa.npa("github:user/repo#path:foo::path:bar", "/test/path");
      }).toThrow();
    });
  });
});
