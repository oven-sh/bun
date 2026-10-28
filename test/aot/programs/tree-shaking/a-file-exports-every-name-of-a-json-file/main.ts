import * as all from "./barrel";
import { version, nested } from "./barrel";
console.log(all.version, version, nested.port, all.nested.port, Object.keys(all).join());
