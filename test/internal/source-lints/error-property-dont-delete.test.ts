import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Node leaves every own property of a system error (code, errno, syscall,
// path, dest, info) configurable, so user code can delete or redefine it:
// https://github.com/nodejs/node/blob/v26.3.0/src/api/exceptions.cc#L141-L149
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L295-L346
// Packages rely on it: winston's format.metadata() deletes each enumerable key
// of the error it logs, and err-code redefines `code` with Object.defineProperty.
// PropertyAttribute::DontDelete makes a property non-configurable, so both
// throw a TypeError, and JS cannot clear the bit later.
//
// So a putDirect on an error that native code just created, or on a plain
// object it attaches to that error (err.info), never passes DontDelete.
// ReadOnly and DontEnum stay available.
const comment = /"(?:[^"\\\n]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm;
const assignment = /\b(\w+)\s*=(?!=)\s*/g;
const errorCreator = /(?:\w+::)*(?:ErrorInstance::create|create\w*Error)\s*\(/y;
const objectCreator = /(?:\w+::)*constructEmptyObject\s*\(/y;
const put = /\b(\w+)\s*(?:->|\.)\s*putDirect\w*\s*\(([^;]*)\)\s*;/g;

function putsOnNativeErrors(source: string): { line: number; dontDelete: boolean }[] {
  // Blanks the comments and keeps every newline, so that line numbers hold.
  const code = source.replace(comment, text => (text[0] === '"' ? text : text.replace(/[^\n]/g, " ")));
  const found: { line: number; dontDelete: boolean }[] = [];
  let offset = 0;
  // WebKit style: a function body ends with `}` in the first column. A class
  // with inline methods is one body, so a variable is what its last assignment
  // before the put made it.
  for (const body of code.split(/^}/m)) {
    const bindings = Array.from(body.matchAll(assignment), m => {
      errorCreator.lastIndex = objectCreator.lastIndex = m.index + m[0].length;
      const kind = errorCreator.test(body) ? "error" : objectCreator.test(body) ? "object" : "other";
      return { name: m[1], index: m.index, kind };
    });
    if (bindings.some(binding => binding.kind === "error")) {
      const kindAt = (name: string, index: number) =>
        bindings.findLast(binding => binding.name === name && binding.index < index)?.kind;
      const puts = Array.from(body.matchAll(put));
      const attached = new Set(
        puts
          .filter(m => kindAt(m[1], m.index) === "error")
          .flatMap(m => m[2].split(",").map(argument => argument.trim())),
      );
      for (const m of puts) {
        const kind = kindAt(m[1], m.index);
        if (kind !== "error" && !(kind === "object" && attached.has(m[1]))) continue;
        const line = code.slice(0, offset + m.index).split("\n").length;
        found.push({ line, dontDelete: m[2].includes("DontDelete") });
      }
    }
    offset += body.length + 1;
  }
  return found;
}

// Checks the detector on a sample, so that the scan below cannot pass because
// the detector stopped matching.
const sample = `
static JSC::JSObject* sample(JSC::JSGlobalObject* globalObject)
{
    JSC::JSObject* result = JSC::ErrorInstance::create(vm, structure, message, {});
    JSC::JSObject* info = JSC::constructEmptyObject(globalObject);
    JSC::JSObject* other = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, names.codePublicName(), code, JSC::PropertyAttribute::DontDelete | 0);
    result->putDirect(vm, names.infoPublicName(), info,
        0);
    info->putDirect(vm, names.errnoPublicName(), errorNumber, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    other->putDirect(vm, names.pathPublicName(), path, JSC::PropertyAttribute::DontDelete | 0);
    /* result->putDirect(vm, names.pathPublicName(), path, JSC::PropertyAttribute::DontDelete | 0); */
    return result;
}

class Sample {
    static JSC::JSObject* makeError(JSC::JSGlobalObject* globalObject)
    {
        JSC::JSObject* result = createError(globalObject, message);
        return result;
    }

    static JSC::JSObject* makeObject(JSC::JSGlobalObject* globalObject)
    {
        JSC::JSObject* result = JSC::constructEmptyObject(globalObject);
        result->putDirect(vm, names.codePublicName(), code, JSC::PropertyAttribute::DontDelete | 0);
        return result;
    }
};
`;

test("the detector sees the puts on an error and on the object the error carries", () => {
  expect(putsOnNativeErrors(sample)).toEqual([
    { line: 7, dontDelete: true },
    { line: 8, dontDelete: false },
    { line: 10, dontDelete: true },
  ]);
});

test("native code does not put DontDelete properties on the errors it creates", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const src = path.join(repoRoot, "src");
  const violations: string[] = [];
  let scanned = 0;

  for await (const rel of new Glob("**/*.cpp").scan({ cwd: src })) {
    scanned++;
    const relFromRepo = path.join("src", rel).replaceAll("\\", "/");
    for (const { line, dontDelete } of putsOnNativeErrors(readFileSync(path.join(src, rel), "utf8"))) {
      if (dontDelete) violations.push(`${relFromRepo}:${line}`);
    }
  }

  // Guards against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(300);

  violations.sort();
  expect(violations).toEqual([]);
});
