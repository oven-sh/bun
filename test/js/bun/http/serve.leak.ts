import { heapStats } from "bun:jsc";
var prevCounts;
export default {
  fetch(req) {
    const out = {};
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
};
