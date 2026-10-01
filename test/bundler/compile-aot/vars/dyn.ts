import { live, setLive, counter, bump, table } from "./other";
export const seenFromHere = () => typeof live + ":" + String(live) + " " + counter + " " + table.size;
export const writeFromHere = (v: any) => { setLive(v); bump(); };
// (A top-level variable that is private to the module.)
var notExportedByIt = 5;
function alsoNotExported() { return notExportedByIt + 1; }
export const usesWhatItKeepsToItself = () => notExportedByIt++ + alsoNotExported();
