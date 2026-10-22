import { trail } from "./trail.ts";
import { first } from "./first.ts";
import { second } from "./second.ts";
import { third } from "./third.ts";

trail.push("main: starts with " + first + ", " + second + ", " + third);

const late = await import("./late.ts");
trail.push("main: late gave " + late.value);

const [again, same] = await Promise.all([import("./late.ts"), import("./first.ts")]);
trail.push("main: the same module objects " + (again === late) + ", first again " + same.first);

for (const line of trail) console.log(line);
