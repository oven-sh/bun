// z.literal([]) throws in zod's constructor at module load. The union parent
// would never exercise that option for a passing string input, so a lazily
// wrapped version would mask the throw forever; the transform must leave the
// expression untouched.
import { z } from "zod";
const S = z.union([z.literal([] as any), z.string()]);
console.log("loaded");
console.log(JSON.stringify(S.safeParse("hi")));
