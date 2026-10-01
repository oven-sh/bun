import { fail } from "./lib.ts";
type Unused = { a: string };

try { fail({ depth: 1 }); } catch (e: any) { console.log(String(e.stack).replace(/\(.*[\\/]t[\\/]maps[\\/]/g, "(").replace(/at .*[\\/]t[\\/]maps[\\/]/g, "at ")); }
if (process.argv[2] === "uncaught") fail({ depth: 0 });
