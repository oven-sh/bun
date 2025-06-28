import { end, start } from "./startEnd.mjs";

start("Second");

import "./second-child.mjs";

end("Second");
