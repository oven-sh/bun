// Every server of this folder that is written on Bun.serve, in one process, one after the other. Each prints the port it listens on.
import "./array-kind.ts";

await import("../bun.ts");
await import("../api-bun.ts");
await import("../features/bun.ts");
