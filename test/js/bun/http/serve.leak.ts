import type { Serve } from "bun";
import { heapStats } from "bun:jsc";
var prevCounts: Record<string, number>;
export default {
  fetch(req: Request) {
    const out: Record<string, number> = {};
    const counts = heapStats().objectTypeCounts;
    for (const key in counts) {
      if (prevCounts) {
        if (prevCounts[key] && counts[key] > prevCounts[key]) {
          out[key] = counts[key];
        }
      } else {
        if (counts[key] > 1) {
          out[key] = counts[key];
        }
      }
    }
    prevCounts = counts;
    if (req.url.includes("gc")) {
      Bun.gc(false);
    }

    return new Response(JSON.stringify(out), {
      headers: {
        "content-type": "application/json",
      },
    });
  },
} satisfies Serve;
