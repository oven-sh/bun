// WebKit keeps its own result of each imported test next to it, in `<test>-expected.txt`: one line per subtest,
// `PASS name` or `FAIL name message`. A subtest that fails there too is not a bug of the port.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sanitize = name => name.replaceAll("\0", "\\0").replaceAll("\r", "\\r").trimEnd();

export function readWebKitResults(wptDirectory, testPath) {
  const file = join(wptDirectory, testPath.replace(/\.html?(?:\?(.*))?$/, (whole, variant) => (variant ? `_${variant}` : "")) + "-expected.txt");
  if (!existsSync(file)) return null;
  const text = "\n" + readFileSync(file, "utf8");
  const lines = [...text.matchAll(/^(PASS|FAIL|TIMEOUT|NOTRUN) (.*)$/gm)];
  return {
    harnessError: /^Harness Error \((\w+)\)/m.exec(text)?.[1] ?? null,
    total: lines.length,
    passed: lines.filter(line => line[1] === "PASS").length,
    passedNames: lines.filter(line => line[1] === "PASS").map(line => line[2]),
    // Asked about a subtest that does not pass here. Two subtests can print the same line, so a failure counts first.
    statusOf(name) {
      const sanitized = sanitize(name);
      const failure = ["FAIL", "TIMEOUT", "NOTRUN"].find(status => text.includes(`\n${status} ${sanitized} `) || text.includes(`\n${status} ${sanitized}\n`));
      return failure ?? (text.includes(`\nPASS ${sanitized}\n`) ? "PASS" : null);
    },
  };
}

// The names that pass in WebKit and that `subtests` does not have at all, because the file stopped early here.
export function namesMissingFrom(subtests, webkit) {
  const firstLines = new Set(subtests.map(subtest => sanitize(subtest.name).split("\n")[0].trimEnd()));
  return webkit.passedNames.filter(name => !firstLines.has(name));
}
