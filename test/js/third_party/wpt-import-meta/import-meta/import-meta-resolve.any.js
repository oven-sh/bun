// META: global=dedicatedworker-module,sharedworker-module,serviceworker-module

import { importMetaOnRootModule, importMetaOnDependentModule }
  from "./import-meta-root.js";

test(() => {
  assert_equals(typeof import.meta.resolve, "function");
  assert_equals(import.meta.resolve.name, "resolve");
  assert_equals(import.meta.resolve.length, 1);
  assert_equals(Object.getPrototypeOf(import.meta.resolve), Function.prototype);
}, "import.meta.resolve is a function with the right properties");

test(() => {
  assert_false(isConstructor(import.meta.resolve));

  assert_throws_js(TypeError, () => new import.meta.resolve("./x"));
}, "import.meta.resolve is not a constructor");

test(() => {
  // See also tests in ./import-meta-resolve-importmap.html.

  assert_equals(import.meta.resolve({ toString() { return "./x"; } }), resolveURL("x"));
  assert_throws_js(TypeError, () => import.meta.resolve(Symbol("./x")),
    "symbol");
  assert_throws_js(TypeError, () => import.meta.resolve(),
    "no argument (which is treated like \"undefined\")");
}, "import.meta.resolve ToString()s its argument");

test(() => {
  assert_equals(import.meta.resolve("./x"), resolveURL("x"),
    "current module import.meta");
  assert_equals(importMetaOnRootModule.resolve("./x"), resolveURL("x"),
    "sibling module import.meta");
  assert_equals(importMetaOnDependentModule.resolve("./x"), resolveURL("x"),
    "dependency module import.meta");
}, "Relative URL-like specifier resolution");

test(() => {
  assert_equals(import.meta.resolve("https://example.com/"), "https://example.com/",
    "current module import.meta");
  assert_equals(importMetaOnRootModule.resolve("https://example.com/"), "https://example.com/",
    "sibling module import.meta");
  assert_equals(importMetaOnDependentModule.resolve("https://example.com/"), "https://example.com/",
    "dependency module import.meta");
}, "Absolute URL-like specifier resolution");

test(() => {
  const invalidSpecifiers = [
    "https://eggplant:b/c",
    "pumpkins.js",
    ".tomato",
    "..zuccini.mjs",
    ".\\yam.es"
  ];

  for (const specifier of invalidSpecifiers) {
    assert_throws_js(TypeError, () => import.meta.resolve(specifier), specifier);
  }
}, "Invalid module specifiers");

test(() => {
  const { resolve } = import.meta;
  assert_equals(resolve("https://example.com/"), "https://example.com/", "current module import.meta");
}, "Works fine with no this value");

function resolveURL(urlRelativeToThisTest) {
  return (new URL(urlRelativeToThisTest, location.href)).href;
}

function isConstructor(o) {
  try {
    new (new Proxy(o, { construct: () => ({}) }));
    return true;
  } catch {
    return false;
  }
}
