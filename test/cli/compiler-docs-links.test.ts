// Links on the pages of docs/compiler, and links to them from the other pages, lead to a page and to a heading on it.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const docs = join(import.meta.dir, "..", "..", "docs");
const site = JSON.parse(readFileSync(join(docs, "docs.json"), "utf8"));
const readWithoutCode = (file: string) => readFileSync(file, "utf8").replace(/^([ \t]*)```.*?^\1```/gms, "");
const isFile = (file: string) => /\.\w+$/.test(file) && existsSync(file);
const findFile = (path: string) => [`${path}.mdx`, `${path}/index.mdx`, path].map(it => join(docs, it)).find(isFile);

const slugOf = (heading: string) =>
  heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
const headingsOf = (file: string) =>
  Array.from(readWithoutCode(file).matchAll(/^#{1,6}\s+(.+?)\s*$/gm), ([, heading]) => slugOf(heading));

function findBrokenLinks(name: string) {
  const file = join(docs, name);
  const page = readWithoutCode(file);
  const links = [...page.matchAll(/\]\(([/#][^)\s]*)\)/g), ...page.matchAll(/^import .* from "(\/[^"]+)";$/gm)];
  return links.flatMap(([, link]) => {
    const [path, heading] = link.split("#");
    if (!name.startsWith("compiler/") && !path.startsWith("/compiler")) return [];
    const target = path ? findFile(path) : file;
    if (!target) return [`${name}: ${link}: no such page`];
    return !heading || headingsOf(target).includes(heading) ? [] : [`${name}: ${link}: no such heading`];
  });
}

test("every link from and to a page of docs/compiler resolves", () => {
  const names = Array.from(new Glob("**/*.mdx").scanSync(docs), name => name.replaceAll("\\", "/")).sort();
  expect(names).toContain("compiler/index.mdx");
  expect(names.flatMap(findBrokenLinks)).toEqual([]);
});

test("docs.json lists every page of docs/compiler", () => {
  const compiler = site.navigation.tabs.find(tab => tab.tab === "Compiler");
  const listed = compiler.groups.flatMap(group => group.pages);
  const pages = Array.from(
    new Glob("*.mdx").scanSync(join(docs, "compiler")),
    name => `/compiler/${name.slice(0, -4)}`,
  );
  expect(pages.filter(page => !listed.includes(page))).toEqual([]);
  expect(listed.filter(page => !findFile(page))).toEqual([]);
});

test("every redirect leads from a page that is gone to a page", () => {
  expect(site.redirects.filter(({ source, destination }) => findFile(source) || !findFile(destination))).toEqual([]);
});
