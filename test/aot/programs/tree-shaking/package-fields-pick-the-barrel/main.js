// Which file is the barrel is for package.json to say: an "exports" map with conditions, "browser" beside "main", an "exports" map with a subpath that is a barrel too. Each package has a barrel that must be picked and one that must not, and each barrel has a file nobody asks for.
import { picked as byExports } from "by-exports";
import { picked as byBrowser } from "by-browser";
import { picked as bySubpath } from "by-exports/sub";

console.log(byExports(), byBrowser(), bySubpath());
