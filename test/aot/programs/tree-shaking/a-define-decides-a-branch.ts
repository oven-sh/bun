// --define gives FEATURE and LEVEL their values at build time. The arm that is not taken goes, with the only reference to its function; the one that is taken stays.
declare const FEATURE: boolean;
declare const LEVEL: number;
declare const NAME: string;

function withFeature() { return "with the feature"; }
function withoutFeature() { return "without the feature"; }
function high() { return "high"; }
function low() { return "low"; }
function named() { return "named"; }
function unnamed() { return "unnamed"; }

console.log(FEATURE ? withFeature() : withoutFeature());
console.log(LEVEL > 2 ? high() : low());
console.log(NAME === "x" ? named() : unnamed());
if (!FEATURE) console.log(withoutFeature());
