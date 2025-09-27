import { Npa } from "bun:internal-for-testing";
import cases from "./cases";
import path from "path";

const normalizePath = (p: string) => p && p.replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/')

const normalizePaths = (spec: any) => {
  spec.fetchSpec = normalizePath(spec.fetchSpec)
  return spec
}

const expectedPatch = (expected: any) => {
  const patched = { ...expected };

  // It's really annoying to differentiate between null and undefined and our use-case could not care less.
  // Convert all undefined values to null
  for (const key in patched) {
    if (patched[key] === undefined) {
      patched[key] = null;
    }
  }

  return patched;
};

const platformAgnosticTests = Object.entries(cases).filter(([name]) => name !== "windows");
const windowsTests = Object.entries(cases).filter(([name]) => name !== "windows");

describe("npa", () => {
  describe("valid cases", () => {
    describe.each(platformAgnosticTests)("%s", (_, caseSet: object) => {
      it.each(Object.entries(caseSet))("parses %s", (input, expected) => {
        const result = Npa.npa(input as string, "/test/a/b");
        expect(result).toMatchObject(expectedPatch(expected));
      });
    });
  });

  if (process.platform === "win32") {
    describe("windows specific cases", () => {
      describe.each(windowsTests)("%s", (_, caseSet: object) => {
        it.each(Object.entries(caseSet))("parses %s", (input, expected) => {
          const result = Npa.npa(input as string);
          expect(normalizePaths(result)).toMatchObject(expected);
        });
      });
    });
  }
});

describe("resolve", () => {
  test("npa.resolve", () => {
    expect(Npa.resolve('foo', '^1.2.3', '/test/a/b')).toMatchObject({
      type: 'range',
    });
  });

  test("Npa.resolve file:", () => {
    expect(normalizePaths(Npa.resolve('foo', 'file:foo', '/test/a/b'))).toMatchObject({
      type: 'directory',
      fetchSpec: '/test/a/b/foo',
    });
  });

  test("Npa.resolve no protocol", () => {
    expect(Npa.resolve('foo', '../foo/bar', '/test/a/b')).toMatchObject({
      type: 'directory',
    });
  });

  test("Npa.resolve file protocol", () => {
    expect(Npa.resolve('foo', 'file:../foo/bar', '/test/a/b')).toMatchObject({
      type: 'directory',
    });
  });

  test("Npa.resolve file protocol w/ tgz", () => {
    expect(Npa.resolve('foo', 'file:../foo/bar.tgz', '/test/a/b')).toMatchObject({
      type: 'file',
    });
  });

  test("Npa.resolve with no name", () => {
    expect(Npa.resolve(null, '4.0.0', '/test/a/b')).toMatchObject({
      type: 'version',
      name: null,
    });
  });

  test("Npa.resolve sets raw right", () => {
    expect(Npa.resolve('foo', 'file:abc')).toMatchObject({
      type: 'directory',
      raw: 'foo@file:abc',
    });
  });

  test("npa with path in @ in it", () => {
    expect(Npa.npa('./path/to/thing/package@1.2.3/')).toMatchObject({
      name: null,
      type: 'directory',
    });
  });

  test("npa w/o leading or trailing slash", () => {
    expect(Npa.npa('path/to/thing/package@1.2.3')).toMatchObject({
      name: null,
      type: 'directory',
    });
  });
});
