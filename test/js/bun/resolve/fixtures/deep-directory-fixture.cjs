// Helpers for tests about paths close to, or past, MAX_PATH_BYTES (see harness).
//
// The kernel limits the length of the path given to one syscall, not the depth
// of the tree. So a directory whose absolute path is longer than the limit can
// be created and filled with paths relative to the process cwd. Every helper
// here restores the cwd before it returns.
//
// process.chdir() needs the new cwd to fit a path buffer afterwards, and bun's
// currently fails one byte earlier than that. `makeDirectoryOfLength` only
// enters directories at least two bytes shorter than the one it returns, so
// `length` may go up to the limit.
// `writeFileIn` and `mkdirIn` enter `dir` itself, so `dir` has to be at least
// two bytes below the limit; what they create inside it may be of any length.
"use strict";
const fs = require("fs");

function inDirectory(dir, fn) {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    fn();
  } finally {
    process.chdir(previous);
  }
}

/**
 * Creates a chain of directories below `parent` (an existing directory) and
 * returns the absolute path of the deepest one, which is exactly `length`
 * bytes long. Components are as long as NAME_MAX allows, so the chain is short
 * enough to remove quickly.
 */
function makeDirectoryOfLength(parent, length) {
  if (length < parent.length + 2) throw new Error(`${length} bytes is too short for a directory below ${parent}`);
  let dir = parent;
  while (dir.length < length) {
    // Bytes left after the separator. When this is not the last component,
    // keep two of them for the separator and first byte of the next one.
    const remaining = length - dir.length - 1;
    const size = remaining <= 255 ? remaining : Math.min(255, remaining - 2);
    const name = Buffer.alloc(size, "d").toString();
    inDirectory(dir, () => fs.mkdirSync(name));
    dir = `${dir}/${name}`;
  }
  return dir;
}

/** Writes `dir/name`, which may be too long to name in one path. */
function writeFileIn(dir, name, contents) {
  inDirectory(dir, () => fs.writeFileSync(name, contents));
}

/** Creates and returns `dir/name`, which may be too long to name in one path. */
function mkdirIn(dir, name) {
  inDirectory(dir, () => fs.mkdirSync(name));
  return `${dir}/${name}`;
}

module.exports = { makeDirectoryOfLength, writeFileIn, mkdirIn };
