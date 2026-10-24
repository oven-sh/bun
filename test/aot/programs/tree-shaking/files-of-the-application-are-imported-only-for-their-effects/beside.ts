import { registry } from "./registry";
function beside() { return "registered beside a used file"; }
registry.push(beside);
export function notUsed() { return "not used"; }
