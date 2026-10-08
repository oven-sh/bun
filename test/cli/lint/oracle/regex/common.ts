import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A string as `bun-lint regex` reads it: four hexadecimal digits for each UTF-16 code unit. */
export function hex(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(4, "0");
  return out;
}

/** Runs `bun-lint regex <command>` on `requests`, each a list of fields. One parsed line of JSON for each. */
export function ask(binary: string, command: string, requests: string[][]): any[] {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bun-lint-regex-"));
  try {
    const file = join(dir, "requests");
    writeFileSync(file, requests.map(fields => fields.join("\t") + "\n").join(""));
    const { stdout, stderr, status, signal } = spawnSync(binary, ["regex", command, file], {
      maxBuffer: 1 << 30,
      encoding: "utf8",
    });
    if (status !== 0) throw new Error(`bun-lint: ${signal ?? status}\n${stderr}`);
    const lines = stdout.split("\n");
    lines.pop();
    if (lines.length !== requests.length) throw new Error(`${lines.length} answers to ${requests.length} requests`);
    return lines.map(line => JSON.parse(line));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
