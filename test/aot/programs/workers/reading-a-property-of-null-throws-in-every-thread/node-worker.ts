import { parentPort } from "node:worker_threads";
import { readThroughNothing } from "./reads";
parentPort!.postMessage("a Worker of node:worker_threads: " + readThroughNothing());
