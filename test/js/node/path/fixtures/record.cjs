// node --expose-internals test/js/node/path/fixtures/record.cjs
// Keeps the inputs in the two .jsonl files and rewrites the expected results with those of the Node.js that runs this.
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { createMatcher } = require("internal/fs/glob");

function rewrite(name, record) {
  const file = path.join(__dirname, name);
  const rows = readFileSync(file, "utf8").trim().split(/\r?\n/).map(JSON.parse).map(record);
  const escape = unit => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0");
  writeFileSync(file, rows.map(row => JSON.stringify(row).replace(/[\x7f-\uffff]/g, escape) + "\n").join(""));
}

rewrite("node-path-results.jsonl", ([platform, name, args]) => {
  const { cwd, env } = process;
  process.cwd = () => (platform === "posix" ? "/home/me" : "C:\\Users\\me");
  process.env = { "=D:": "D:\\work", "=d:": "d:\\work", "=Z:": "Y:\\elsewhere" };
  const result = path[platform][name](...args);
  Object.assign(process, { cwd, env });
  return [platform, name, args, name === "parse" ? Object.values(result) : result];
});

rewrite("node-glob-results.jsonl", ([glob, flags, matching, notMatching]) => {
  const options = { platform: flags.includes("w") ? "win32" : "posix", nocase: flags.includes("i") };
  const paths = typeof matching === "string" ? ["a"] : [...matching, ...notMatching];
  // A new matcher for each path: matching writes the drive letter of the path into the matcher.
  const matches = pathname => createMatcher(glob, options).match(pathname);
  try {
    return [glob, flags, paths.filter(matches), paths.filter(pathname => !matches(pathname))];
  } catch (error) {
    return [glob, flags, String(error)];
  }
});
