// Version numbers parsed with a regular expression, compared and sorted, and file paths normalized, split and made relative with string methods.
const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/;

function parseVersion(text) {
  const match = versionPattern.exec(text.trim());
  if (!match) return null;
  return { major: +match[1], minor: parseInt(match[2], 10), patch: Number(match[3]), tag: match[4] ? match[4].split(".") : [] };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || b.tag.length - a.tag.length;
}

function satisfies(version, range) {
  const wanted = parseVersion(range.slice(1));
  if (range[0] === "^") return version.major === wanted.major && compareVersions(version, wanted) >= 0;
  if (range[0] === "~") return version.major === wanted.major && version.minor === wanted.minor && version.patch >= wanted.patch;
  return compareVersions(version, wanted) === 0;
}

function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + out.join("/");
}

function extension(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function relative(from, to) {
  const a = normalize(from).split("/");
  const b = normalize(to).split("/");
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return "../".repeat(a.length - shared) + b.slice(shared).join("/");
}

function run(count) {
  const versions = ["1.2.3", "v1.10.0", "2.0.0-beta.1", "1.2.10", " 0.9.12 ", "not a version"];
  const ranges = ["^1.2.0", "~1.2.3", "=2.0.0"];
  const paths = ["/usr/local/../lib/./node/index.js", "src//util/../main.test.ts", "/a/b/c/../../d/.hidden", "plain"];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const version = parseVersion(versions[i % 6]);
    if (version) total += satisfies(version, ranges[i % 3]) ? 3 : 1;
    const path = paths[i & 3];
    total += normalize(path).length + extension(path).length + relative("/usr/lib/node", path).length;
    if ((i & 15) === 0) {
      const sorted = versions.map(parseVersion).filter(Boolean).sort(compareVersions);
      total += sorted[0].patch + sorted[sorted.length - 1].major;
    }
  }
  return total;
}

console.log(run(250000));
