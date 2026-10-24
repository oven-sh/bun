import { Glob } from "bun";
import { expect, test } from "bun:test";
import path from "node:path";

// WTF::setTimeZoneOverride() takes only what ICU reads, and tells a miss with a `false` that is easy to drop: a caller
// that drops it keeps the previous zone in silence. Six call sites did. Every writer of the time zone (the start of
// the process, process.env.TZ, bun:jsc setTimeZone, `bun test --isolate`) now goes through the two functions below,
// which also reset the Date caches.
test("only setProcessTimeZone() and clearProcessTimeZone() call WTF::setTimeZoneOverride()", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const home = "src/jsc/bindings/JSEnvironmentVariableMap.cpp";
  const call = /\bsetTimeZoneOverride\s*\(/g;

  // Rust reaches the override only through a C++ function, so the C++ sources are all there is to read.
  const files = [...new Glob("**/*.{h,cpp}").scanSync({ cwd: path.join(repoRoot, "src") })];
  expect(files.length).toBeGreaterThan(0);
  const sources = await Promise.all(files.map(rel => Bun.file(path.join(repoRoot, "src", rel)).text()));
  const callers = files
    .filter((_, index) => sources[index].includes("setTimeZoneOverride") && sources[index].match(call))
    .map(rel => path.join("src", rel).replaceAll("\\", "/"));
  expect(callers).toEqual([home]);

  // The body of a function definition at the start of a line, up to the `}` at the start of a line.
  const source = sources[files.findIndex(rel => path.join("src", rel).replaceAll("\\", "/") === home)];
  const callsIn = (signature: string) => {
    const start = source.indexOf(`\n${signature}`);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("\n}\n", start)).match(call)?.length ?? 0;
  };
  expect({
    inFile: source.match(call)?.length,
    setProcessTimeZone: callsIn("bool setProcessTimeZone(JSC::VM& vm, StringView zoneID)"),
    clearProcessTimeZone: callsIn("void clearProcessTimeZone(JSC::VM& vm)"),
  }).toEqual({ inFile: 2, setProcessTimeZone: 1, clearProcessTimeZone: 1 });
});
