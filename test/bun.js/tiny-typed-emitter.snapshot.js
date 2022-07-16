/**
 * https://github.com/oven-sh/bun/issues/453
 */
import { createRequire as topLevelCreateRequire } from "module";
import { TypedEmitter as TypedEmitter7 } from "tiny-typed-emitter";

const require = topLevelCreateRequire(import.meta.url);
