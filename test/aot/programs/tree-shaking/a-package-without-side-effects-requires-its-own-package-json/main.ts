import { version, name } from "quiet";
import pkg from "quiet/package.json";
console.log(version, name, pkg.version, require("quiet/package.json").main);
