import { Glob } from "bun";
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// A native class constructor is a JSC::InternalFunction. The code that wires a
// class up (LazyClassStructure::Initializer::setConstructor and the hand written
// setup functions) writes prototype.constructor, but nothing writes
// constructor.prototype: every constructor's finishCreation has to put that
// property itself. When one forgets, `Ctor.prototype` is undefined and both
// `x instanceof Ctor` and `class Sub extends Ctor {}` throw a TypeError. That
// happened to X509Certificate (#27455), to the eight JSSink constructors, and to
// the native Hash and Hmac constructors (#39936), each time by copying a
// constructor that already had the line missing.
//
// Rule: a file that declares an InternalFunction subclass, or its .h/.cpp twin,
// references vm.propertyNames->prototype.
const declaresInternalFunction = /\bpublic\s+(?:JSC::)?InternalFunction\b/;
const installsPrototype = /\bpropertyNames->prototype\b/;

// InternalFunction subclasses that do not own a prototype object.
const exempt = [
  // `new CString(ptr)` returns a string. There is no instance type to have a prototype (#35246).
  "src/jsc/bindings/JSFFICString.h",
  // FunctionTemplate::makeFunction puts a prototype on every function it creates.
  "src/jsc/bindings/v8/shim/Function.h",
  // Internal to the v8 shim. JS never sees it as a constructor.
  "src/jsc/bindings/v8/shim/ObjectTemplate.h",
  // `prototype` is a row of the constructor's static hash table (getModulePrototypeObject).
  "src/jsc/modules/NodeModuleModule.cpp",
];

function twinOf(file: string): string | undefined {
  if (file.endsWith(".h")) return file.slice(0, -".h".length) + ".cpp";
  if (file.endsWith(".cpp")) return file.slice(0, -".cpp".length) + ".h";
  return undefined;
}

test("every InternalFunction subclass installs its prototype property", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const src = path.join(repoRoot, "src");

  // The codegen templates count too: generate-classes.ts and generate-jssink.ts
  // each emit one constructor class per generated type.
  const globs = [new Glob("**/*.{h,cpp}"), new Glob("codegen/**/*.ts")];
  const declaring: string[] = [];
  const violations: string[] = [];

  for (const glob of globs) {
    for await (const rel of glob.scan({ cwd: src })) {
      const absolute = path.join(src, rel);
      if (!declaresInternalFunction.test(readFileSync(absolute, "utf8"))) continue;

      const relFromRepo = path.join("src", rel).replaceAll("\\", "/");
      declaring.push(relFromRepo);
      if (exempt.includes(relFromRepo)) continue;

      const candidates = [absolute];
      const twin = twinOf(absolute);
      if (twin && existsSync(twin)) candidates.push(twin);
      if (candidates.some(file => installsPrototype.test(readFileSync(file, "utf8")))) continue;

      violations.push(relFromRepo);
    }
  }

  // Guards against a vacuous pass: the scan found the constructors, and every
  // exemption still names a file that declares one.
  expect(declaring.length).toBeGreaterThan(30);
  expect(exempt.filter(file => !declaring.includes(file))).toEqual([]);

  violations.sort();
  expect(violations).toEqual([]);
});
