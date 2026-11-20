// glob.test.ts runs this file with Bun and with Node.js and expects the same rows from both.
// The working directory is a tree named "work": top.ts, src/index.ts, src/lib/util.ts and the empty directory links.
// A row is "parentPath | name | type" of a Dirent. "<cwd>" is process.cwd() and "<up>" is the directory above it.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const cwd = process.cwd();
fs.symlinkSync(path.join(cwd, "src", "lib"), path.join(cwd, "links", "to-lib"), "junction");

function type(dirent) {
  if (dirent.isFile()) return "file";
  if (dirent.isDirectory()) return "directory";
  if (dirent.isSymbolicLink()) return "link";
  return "other";
}

function slashes(string) {
  return string.replace(cwd, "<cwd>").replace(path.dirname(cwd), "<up>").split(path.sep).join("/");
}

function rows(dirents) {
  return dirents.map(dirent => dirent && `${slashes(dirent.parentPath)} | ${dirent.name} | ${type(dirent)}`).sort();
}

const entryPoints = {
  "fs.globSync": async (pattern, options) => fs.globSync(pattern, options),
  "fs.glob": (pattern, options) =>
    new Promise((resolve, reject) => {
      fs.glob(pattern, options, (err, dirents) => (err ? reject(err) : resolve(dirents)));
    }),
  "fs.promises.glob": (pattern, options) => Array.fromAsync(fs.promises.glob(pattern, options)),
};

const cwdOptions = {
  "omitted": {},
  "undefined": { cwd: undefined },
  "null": { cwd: null },
  "''": { cwd: "" },
  "'.'": { cwd: "." },
  "'src'": { cwd: "src" },
  "absolute": { cwd },
  "file URL": { cwd: pathToFileURL(cwd) },
};

const patternsWithoutCwd = [
  "*",
  "src/*",
  "src/**",
  "links/*",
  "src/lib/util.ts",
  "src/**/..",
  "**/..",
  path.join(cwd, "src", "*.ts"),
];

async function main() {
  const out = {};

  for (const [name, glob] of Object.entries(entryPoints)) {
    const byCwd = {};
    for (const [label, options] of Object.entries(cwdOptions)) {
      const pattern = label === "'src'" ? "lib/*.ts" : "src/lib/*.ts";
      byCwd[label] = rows(await glob(pattern, { withFileTypes: true, ...options }));
    }

    const withoutCwd = {};
    for (const pattern of patternsWithoutCwd) {
      withoutCwd[slashes(pattern)] = rows(await glob(pattern, { withFileTypes: true }));
    }

    out[name] = {
      "src/lib/*.ts by cwd": byCwd,
      "without cwd": withoutCwd,
      "**/.. with cwd 'src'": rows(await glob("**/..", { withFileTypes: true, cwd: "src" })),
    };
  }

  // Each of these two patterns is a row for one kind of entry point only. From the other kind, a Dirent has the
  // name of the temporary directory above the tree. The second pattern is a POSIX path.
  out["fs.globSync"]["without cwd"]["../"] = rows(fs.globSync("../", { withFileTypes: true }));
  if (path.sep === "/") {
    for (const name of ["fs.glob", "fs.promises.glob"]) {
      const dirents = await entryPoints[name](`${cwd}/src/**/..`, { withFileTypes: true });
      out[name]["without cwd"]["<cwd>/src/**/.."] = rows(dirents);
    }
  }
  // Here the walk finds the tree as "." and also as an entry of "..".
  const twice = ["../*", "src/**/.."];
  out["fs.globSync"]["without cwd"][twice.join(" and ")] = rows(fs.globSync(twice, { withFileTypes: true }));

  out["constructor.name for src/index.ts"] = fs.globSync("src/index.ts", { withFileTypes: true })[0].constructor.name;

  out["path.join(parentPath, name)"] = {
    strings: fs.globSync("src/**").map(slashes).sort(),
    joined: fs
      .globSync("src/**", { withFileTypes: true })
      .map(dirent => slashes(path.join(dirent.parentPath, dirent.name)))
      .sort(),
  };

  // What an exclude function receives, and the results after the call.
  out["exclude"] = {};
  for (const [name, pattern] of [
    ["fs.globSync", "src/**/*.ts"],
    ["fs.promises.glob", "src/**/*.ts"],
    ["fs.globSync", "./src/*"],
  ]) {
    const received = [];
    const exclude = dirent => {
      received.push(dirent);
      return false;
    };
    const results = await entryPoints[name](pattern, { withFileTypes: true, exclude });
    out["exclude"][`${name} ${pattern}`] = { received: rows(received), results: rows(results) };
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
