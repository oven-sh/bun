import { readThroughNothing } from "./reads";
postMessage("a Worker inside a Worker: " + readThroughNothing());
