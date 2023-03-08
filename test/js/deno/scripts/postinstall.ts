import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import imports from "../resources/imports.json";
import tests from "../resources/tests.json";

for (const test of tests) {
  const path = join(import.meta.dir, "..", test.path);
  const url = new URL(test.remotePath, "https://raw.githubusercontent.com/denoland/deno/main/cli/tests/");
  const response = await fetch(url);
  console.log(response.status, url.toString(), "->", test.path);
  if (!response.ok) {
    throw new Error(`Failed to download from GitHub: ${url} [status: ${response.status}]`);
  }
  let body = await response.text();
  for (const query of imports) {
    const pattern = new RegExp(`"(.*${query})"`, "gmi");
    body = body.replace(pattern, '"deno:harness"');
  }
  const src = `// Updated: ${response.headers.get("Date")}
// URL: ${url}
${body}`;
  try {
    mkdirSync(dirname(path));
  } catch {}
  await Bun.write(path, src);
}
