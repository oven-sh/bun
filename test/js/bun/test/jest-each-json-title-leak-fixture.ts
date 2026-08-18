import { test } from "bun:test";
import { rss } from "harness";

// Registers LEAK_FIXTURE_ROWS tests whose `%j` title stringifies a ~512KB
// object. Each registration formats the title through format_label's
// `%j` arm. The last test reports RSS so the parent can compare runs.
const rows = Number(process.env.LEAK_FIXTURE_ROWS ?? "8");
const big = { s: Buffer.alloc(512 * 1024, "x").toString() };
const table = Array.from({ length: rows }, () => [big]);

test.each(table)("%j", () => {});

test("report rss", () => {
  Bun.gc(true);
  console.log("RSS_BYTES:" + rss());
});
