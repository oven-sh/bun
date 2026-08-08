// Prints heap object/function counts after constructing many schemas, plus a
// correctness canary. The test compares transform-on vs transform-off runs.
import { z } from "zod";
import { heapStats } from "bun:jsc";

const COUNT = 300;
const schemas: any[] = [];
for (let i = 0; i < COUNT; i++) {
  schemas.push(
    z.object({
      id: z.string().min(1),
      count: z.number().int().min(0),
      kind: z.enum(["a", "b", "c"]),
      tags: z.array(z.string()).default([]),
      nested: z.object({ flag: z.boolean().optional() }),
      variant: z.discriminatedUnion("type", [
        z.object({ type: z.literal("x"), x: z.string() }),
        z.object({ type: z.literal("y"), y: z.number() }),
      ]),
    }),
  );
}

Bun.gc(true);
const counts = heapStats().objectTypeCounts;
const parsed = schemas[0].parse({
  id: "i",
  count: 1,
  kind: "a",
  nested: {},
  variant: { type: "y", y: 2 },
});
console.log(
  JSON.stringify({
    objects: counts.Object ?? 0,
    functions: counts.Function ?? 0,
    canary: parsed,
  }),
);
