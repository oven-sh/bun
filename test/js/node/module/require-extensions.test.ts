import { test, mock, expect } from "bun:test";
import path from "path";

test("require.extensions shape makes sense", () => {
  const extensions = require.extensions;
  expect(extensions).toBeDefined();
  expect(typeof extensions).toBe("object");
  expect(extensions[".js"]).toBeFunction();
  expect(extensions[".json"]).toBeFunction();
  expect(extensions[".node"]).toBeFunction();
  // When --experimental-strip-types is passed, TypeScript files can be loaded.
  expect(extensions[".cts"]).toBeFunction();
  expect(extensions[".ts"]).toBeFunction();
  expect(extensions[".mjs"]).toBeFunction();
  expect(extensions[".mts"]).toBeFunction();
});
test("custom require extension 1", () => {
  const custom = require.extensions['.custom'] = mock(function (module, filename) {
    expect(filename).toBe(path.join(import.meta.dir, 'extensions-fixture', 'c.custom'));
    (module as any)._compile(`module.exports = 'custom';`, filename);
  });
  const mod = require('./extensions-fixture/c');
  expect(mod).toBe('custom');
  expect(custom.mock.calls.length).toBe(1);
  delete require.extensions['.custom'];
  expect(() => require('./extensions-fixture/c')).toThrow(/Cannot find module/);
  expect(require('./extensions-fixture/c.custom')).toBe('custom'); // already loaded
  delete require.cache[require.resolve('./extensions-fixture/c.custom')];
  expect(custom.mock.calls.length).toBe(1);
  expect(require('./extensions-fixture/c.custom')).toBe('c dot custom'); // use js loader
});
test("custom require extension overwrite default loader", () => {
  const original = require.extensions['.js'];
  try {
    const custom = require.extensions['.js'] = mock(function (module, filename) {
      expect(filename).toBe(path.join(import.meta.dir, 'extensions-fixture', 'd.js'));
      (module as any)._compile(`module.exports = 'custom';`, filename);
    });
    const mod = require('./extensions-fixture/d');
    expect(mod).toBe('custom');
    expect(custom.mock.calls.length).toBe(1);
    require.extensions['.js'] = original;
    expect(require('./extensions-fixture/d')).toBe('custom'); // already loaded
    delete require.cache[require.resolve('./extensions-fixture/d')];
    expect(custom.mock.calls.length).toBe(1);
    expect(require('./extensions-fixture/d')).toBe('d.js'); // use js loader
  } finally {
    require.extensions['.js'] = original;
  }
});
test("custom require extension overwrite default loader with other default loader", () => {
  const original = require.extensions['.js'];
  try {
    require.extensions['.js'] = require.extensions['.ts']!;
    const mod = require('./extensions-fixture/e.js'); // should not enter JS
    expect(mod).toBe('hello world');
  } finally {
    require.extensions['.js'] = original;
  }
});
test("test that assigning properties weirdly wont do anything bad", () => {
  const original = require.extensions['.js'];
  try {
    function f1() {}
    function f2() {}
    require.extensions['.js'] = f1;
    require.extensions['.abc'] = f2;
    require.extensions['.js'] = f2;
    require.extensions['.js'] = undefined;
    require.extensions['.abc'] = undefined;
    require.extensions['.abc'] = f1;
    require.extensions['.js'] = f2;
  } finally {
    require.extensions['.js'] = original;
  }
});