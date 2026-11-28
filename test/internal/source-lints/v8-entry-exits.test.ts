import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// An entry of the V8 API returns to addon code. When no JavaScript is below the addon, nothing takes an exception that
// the entry leaves on the VM: the addon's next V8 calls fail. So an entry that fails reports the exception first, with
// V8_RETURN_IF_EXCEPTION or v8::shim::reportUncaughtException (src/jsc/bindings/v8/v8.h). A plain RETURN_IF_EXCEPTION
// compiles, passes every test that calls the entry from JavaScript, and leaves the exception pending.
test("V8 API entries report an exception before they return it to the addon", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const check = /\bRETURN_IF_EXCEPTION\w*\(|\.exception\(\)/;
  const reports = /\bV8_RETURN_IF_EXCEPTION\(|\breportUncaughtException\(/;
  // shim::constructUngated returns its result from inside a NapiUngatedScope and reports after the scope.
  const returnsResult = /if \(!\w+\.exception\(\)\)/;
  // The function that does the report reads the exception that it reports.
  const known = [
    "src/jsc/bindings/v8/shim/UncaughtException.cpp: if (JSC::Exception* exception = scope.exception(); exception && scope.tryClearException())",
  ];

  const found: string[] = [];
  let entries = 0;
  for await (const rel of new Glob("src/jsc/bindings/v8/**/*.{cpp,h}").scan({ cwd: repoRoot })) {
    const file = rel.replaceAll("\\", "/");
    const lines = readFileSync(path.join(repoRoot, file), "utf8").split(/\r?\n/);
    // A function body is the lines between a `{` and a `}` that each stand alone in the first column.
    for (let start = lines.indexOf("{"); start !== -1; start = lines.indexOf("{", start + 1)) {
      const body = lines.slice(start, lines.indexOf("}", start));
      // An entry holds a TopExceptionScope. A function that JavaScript calls holds a ThrowScope and returns to its caller.
      if (!body.some(line => line.includes("DECLARE_TOP_EXCEPTION_SCOPE"))) continue;
      entries++;
      // The report runs JavaScript, which a NapiUngatedScope forbids. The macro would report under the scope.
      const ungated = body.some(line => line.includes("NapiUngatedScope"));
      body.forEach((line, i) => {
        if (ungated && line.includes("V8_RETURN_IF_EXCEPTION(")) found.push(`${file}: ${line.trim()}`);
        if (!check.test(line)) return;
        const reported = returnsResult.test(line)
          ? body.slice(i + 1).some(later => reports.test(later))
          : !ungated && (reports.test(line) || reports.test(body[i + 1] ?? ""));
        if (!reported) found.push(`${file}: ${line.trim()}`);
      });
    }
  }
  // Guard against a wrong repoRoot or a changed brace style, which would make the lint pass vacuously.
  expect(entries).toBeGreaterThan(15);
  expect(found.sort()).toEqual(known);
});
