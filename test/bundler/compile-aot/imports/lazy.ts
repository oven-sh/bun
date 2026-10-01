import { counter, bump, K, Box, arrow } from "./shared";
import { Renamed, fromStar } from "./reexport";
import { early, tdz } from "./cycleB";
export function fromLazy(): string { bump(); return [counter, K, new Box(3).get(), arrow(4), Renamed, fromStar, early, tdz].join(","); }
