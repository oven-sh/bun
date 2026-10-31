// Watches symlinks and prints the events of every watcher, per scenario, as
// JSON. Runs under bun and under node. argv[2] is an empty directory to use.
import fs from "node:fs";
import path from "node:path";

// Makes <scenario>/links/<linkName> point at <scenario>/real/<name>.
function symlinked(scenario, name, linkName, isDirectory) {
  const target = path.join(process.argv[2], scenario, "real", name);
  const link = path.join(process.argv[2], scenario, "links", linkName);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (isDirectory) {
    fs.mkdirSync(target, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "x");
  }
  fs.symlinkSync(target, link);
  return { target, link };
}

// Watches every path at once, in key order, then runs `act`. Resolves with
// the first `count` events of each watcher.
async function collect(paths, count, act) {
  const watchers = [];
  try {
    const all = Object.entries(paths).map(
      ([key, watched]) =>
        new Promise((resolve, reject) => {
          const events = [];
          const watcher = fs.watch(watched, (eventType, filename) => {
            if (events.length < count && events.push([eventType, filename]) === count) resolve([key, events]);
          });
          watchers.push(watcher);
          watcher.once("error", reject);
        }),
    );
    act();
    return Object.fromEntries(await Promise.all(all));
  } finally {
    for (const watcher of watchers) watcher.close();
  }
}

const results = {};
{
  const { target, link } = symlinked("changed", "target.txt", "link.txt", false);
  results["file changed"] = await collect({ link }, 1, () => fs.appendFileSync(target, "y"));
}
{
  // unlink(2) emits IN_ATTRIB (link count drop), IN_DELETE_SELF, IN_IGNORED.
  const { target, link } = symlinked("removed", "target.txt", "link.txt", false);
  results["file removed"] = await collect({ link }, 3, () => fs.unlinkSync(target));
}
{
  const { target, link } = symlinked("rmdir", "target-dir", "link-dir", true);
  results["directory removed"] = await collect({ link }, 2, () => fs.rmdirSync(target));
}
{
  const { target, link } = symlinked("entry", "target-dir", "link-dir", true);
  results["directory entry created"] = await collect({ link }, 1, () =>
    fs.writeFileSync(path.join(target, "child.txt"), "x"),
  );
}
{
  const { target, link } = symlinked("file-first", "target.txt", "link.txt", false);
  results["file watched first, file removed"] = await collect({ target, link }, 3, () => fs.unlinkSync(target));
}
{
  const { target, link } = symlinked("symlink-first", "target.txt", "link.txt", false);
  results["symlink watched first, file removed"] = await collect({ link, target }, 3, () => fs.unlinkSync(target));
}
console.log(JSON.stringify(results));
