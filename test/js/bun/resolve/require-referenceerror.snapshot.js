/**
 * https://github.com/oven-sh/bun/issues/685
 */
import { v4 as uuidv4 } from "uuid";
Bun.inspect(uuidv4());
