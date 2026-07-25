import { parentPort } from "node:worker_threads";
import { otherMain } from "./import-meta-main-other-fixture.mjs";
parentPort.postMessage({ entry: import.meta.main, other: otherMain });
