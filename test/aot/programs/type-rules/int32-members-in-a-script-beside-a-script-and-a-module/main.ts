// This file is a script, so its types are global. Another script and a module are entry points too, and their types have the same member names with fractions.
type int32 = import("bun").int32;
interface Spot { x: int32; y: int32 }
function makeSpot(x: int32, y: int32): Spot { return { x, y }; }
function namedSpot(spot: Spot): int32 { return spot.x; }
function unnamedSpot(): int32 { return makeSpot(3, 4).y; }
console.log(namedSpot(makeSpot(1, 2)), unnamedSpot());
