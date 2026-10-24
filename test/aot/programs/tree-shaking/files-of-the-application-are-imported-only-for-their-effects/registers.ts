import { registry } from "./registry";
function bare() { return "registered by a bare import"; }
registry.push(bare);
