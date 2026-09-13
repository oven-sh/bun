// Loads and drops one ES module over and over and prints how much RSS grew.
//
// Every module record gets an import.meta object whose native part owns the
// module's URL string. The module here is virtual and its specifier is 512 KB
// long, so each collected import.meta object that does not release its URL
// costs 512 KB.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const iterations = parseInt(process.argv[2] ?? "200");
const specifier = "import-meta-url-leak-" + Buffer.alloc(512 * 1024, "m").toString() + ".mjs";

Bun.plugin({
  name: "import-meta-url-leak",
  setup(build) {
    build.module(specifier, () => ({ contents: "export const urlLength = import.meta.url.length;", loader: "js" }));
  },
});

async function load() {
  // Deleting the cache entry removes the module from the registry, so the next
  // import() creates a new module record (and a new import.meta object).
  delete require.cache[specifier];
  const { urlLength } = await import(specifier);
  if (urlLength < specifier.length) throw new Error("unexpected import.meta.url length " + urlLength);
}

for (let i = 0; i < 8; i++) await load();
Bun.gc(true);
const before = process.memoryUsage.rss();

for (let i = 0; i < iterations; i++) {
  await load();
  if (i % 16 === 15) Bun.gc(true);
}
Bun.gc(true);
const after = process.memoryUsage.rss();

console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
