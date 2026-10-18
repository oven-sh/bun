import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { declarationsOf, declarationsPath, doorsPath, readTrimFeatures, removedOnlyWith } from "../../scripts/build/trim-features";

const doors = readFileSync(doorsPath, "utf8");
const all = readTrimFeatures(doors);
const features = doors
  .split("\n")
  .filter(line => line.startsWith("feature "))
  .map(line => line.split(" ")[1]);

test("packages/bun-types/trim.d.ts is what scripts/build/trim-features.ts makes of scripts/build/islands.doors", () => {
  expect(readFileSync(declarationsPath, "utf8"), "Run: bun scripts/build/trim-features.ts").toBe(declarationsOf(doors));
});

test("every public name is spelled like an option, stands once, and says what it is and what it saves", () => {
  const names = all.names.map(each => each.name);
  expect(names.filter(name => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name))).toEqual([]);
  expect(names).toEqual([...new Set(names)]);
  expect(all.names.filter(each => !each.about.endsWith(".")).map(each => each.name)).toEqual([]);
  expect(all.names.filter(each => !each.saves || Number.isNaN(each.saves.linux + each.saves.macos)).map(each => each.name)).toEqual([]);
});

test("public names and libraries are made of features", () => {
  const named = [...all.names.flatMap(each => [...each.features, ...each.also.map(also => also.feature)]), ...all.libraries.flatMap(library => library.features)];
  expect(named.filter(feature => !features.includes(feature))).toEqual([]);
  expect(all.names.filter(each => each.features.length === 0).map(each => each.name)).toEqual([]);
});

test("whatever needs a public name has a public name of its own, or the name says what of it stops working", () => {
  expect(all.names.flatMap(each => removedOnlyWith(all, each).filter(name => name.startsWith("(")).map(name => `${each.name} is needed by ${name}`))).toEqual([]);
});

test("a line that says what else stops working stands for a feature that does need the name", () => {
  const idle = all.names.flatMap(each =>
    each.also.filter(also => !all.needs.some(({ needed, dependent }) => each.features.includes(needed) && dependent === also.feature)).map(also => `${each.name} ${also.feature}`),
  );
  expect(idle).toEqual([]);
});

test("every vendored library stands in a library line, with the version that is built", () => {
  const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const folder = join(dirname(doorsPath), "deps");
  const vendored = readdirSync(folder).filter(file => file.endsWith(".ts") && !["index.ts", "nodejs-headers.ts", "webkit.ts"].includes(file));
  const versions = vendored.map(file => {
    const pinned = /_COMMIT = "([0-9a-f]{40})";(?: \/\/ v?(\S+))?/.exec(readFileSync(join(folder, file), "utf8"));
    const inTree = /#define SQLITE_VERSION +"([^"]+)"/.exec(readFileSync(join(folder, "..", "..", "..", "src", "jsc", "bindings", "sqlite", "sqlite3_local.h"), "utf8"));
    return [basename(file, ".ts"), pinned ? (pinned[2] ?? pinned[1]!.slice(0, 8)) : inTree![1]!] as const;
  });
  const listed = versions.map(([name]) => {
    const library = all.libraries.find(each => plain(each.name).startsWith(plain(name)));
    return [name, library?.version] as const;
  });
  expect(listed).toEqual(versions);
  expect(all.libraries.length).toBe(vendored.length);
});

test("what compiled code calls, and what every executable needs, has no public name", () => {
  expect(all.names.flatMap(each => each.features).filter(feature => feature.startsWith("operations_") || feature === "file_sink")).toEqual([]);
});
