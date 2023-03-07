import { end, start } from "./startEnd.mjs";

start("First");

import "./second.mjs";
import "./third.mjs";

end("First");
