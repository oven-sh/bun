// Every server of this folder that is written on Hono, in one process, one after the other. Each prints the port it listens on.
import "./array-kind.ts";

await import("../hono.ts");
await import("../api-hono.ts");
await import("../features/hono.ts");
