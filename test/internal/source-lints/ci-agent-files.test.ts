import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// scripts/agent.ts runs on CI machines from a copy: `install` copies the script
// and the files it imports into the agent's home, and the Windows image bake
// uploads the same files with Packer. Both go by a list of file names, and a
// file missing from a list is only noticed when a freshly baked machine fails
// to start its agent. This lint derives the list from the imports instead.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const scripts = path.join(root, "scripts");

function importsOf(file: string): string[] {
  const source = readFileSync(path.join(scripts, file), "utf8");
  return [...source.matchAll(/^import\s[^;]*?from\s+"(\.[^"]+)";/gm)].map(match => match[1]!);
}

function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      // Everything the agent imports sits next to it, so a name is enough to copy it.
      expect(path.dirname(specifier)).toBe(".");
      pending.push(path.basename(specifier));
    }
  }
  return [...seen].sort();
}

const expected = importClosure("agent.ts");

test("agentFiles in scripts/agent.ts is agent.ts and everything it imports", () => {
  const source = readFileSync(path.join(scripts, "agent.ts"), "utf8");
  const list = /^const agentFiles = (\[[^\]]*\]);/m.exec(source);
  if (list === null) throw new Error("agentFiles not found in scripts/agent.ts");
  expect((JSON.parse(list[1]!) as string[]).sort()).toEqual(expected);
});

test.each(["windows-x64.pkr.hcl", "windows-arm64.pkr.hcl"])("%s uploads the same files", template => {
  const source = readFileSync(path.join(scripts, "packer", template), "utf8");
  const uploads = [...source.matchAll(/source\s*=\s*"\$\{var\.scripts_dir\}\/([^"]+)"/g)].map(match => match[1]!);
  expect(uploads.sort()).toEqual(expected);
  for (const name of uploads) {
    expect(source).toContain(`destination = "C:\\\\buildkite-agent\\\\${name}"`);
  }
});
