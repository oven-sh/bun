import { registry } from "./registry";
function named() { return "registered by a file whose name is never read"; }
registry.push(named);
export function neverRead() { return "never read"; }
