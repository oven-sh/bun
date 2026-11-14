import { run } from "../turns";
import { start } from "./terminal/session";

const session = start(30, process.argv[2] === "painted");

await run(() => session.turn(), { asARequest: true });
