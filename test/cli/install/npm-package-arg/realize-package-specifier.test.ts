import { npa } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("realize-package-specifier", () => {
  let result;

  result = npa("a.tar.gz", "/test/a/b");
  expect(result.type).toBe("file"); // local tarball

  result = npa("d", "/test/a/b");
  expect(result.type).toBe("range"); // remote package

  result = npa("file:./a.tar.gz", "/test/a/b");
  expect(result.type).toBe("file"); // local tarball

  result = npa("file:./b", "/test/a/b");
  expect(result.type).toBe("directory"); // local package directory

  result = npa("file:./c", "/test/a/b");
  expect(result.type).toBe("directory"); // non-package local directory, specified with a file URL

  result = npa("file:./d", "/test/a/b");
  expect(result.type).toBe("directory"); // no local directory, specified with a file URL
});

test("named realize-package-specifier", () => {
  let result;

  result = npa("a@a.tar.gz", "/test/a/b");
  expect(result.type).toBe("file"); // named local tarball

  result = npa("d@d", "/test/a/b");
  expect(result.type).toBe("tag"); // remote package

  result = npa("a@file:./a.tar.gz", "/test/a/b");
  expect(result.type).toBe("file"); // local tarball

  result = npa("b@file:./b", "/test/a/b");
  expect(result.type).toBe("directory"); // local package directory

  result = npa("c@file:./c", "/test/a/b");
  expect(result.type).toBe("directory"); // non-package local directory, specified with a file URL

  result = npa("d@file:./d", "/test/a/b");
  expect(result.type).toBe("directory"); // no local directory, specified with a file URL

  result = npa("e@e/2", "test/a/b");
  expect(result.type).toBe("git"); // hosted package dependency is git
  expect(result.hosted.type).toBe("github"); // github package dependency

  result = npa("e@1", "/test/a/b");
  expect(result.type).toBe("range"); // range like specifier is never a local file

  result = npa("e@1.0.0", "/test/a/b");
  expect(result.type).toBe("version"); // version like specifier is never a local file
});
