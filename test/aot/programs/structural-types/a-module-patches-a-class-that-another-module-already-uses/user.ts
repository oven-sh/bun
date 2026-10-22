import { Logger, shared } from "./logger.ts";

export function use(message: string): string {
  shared.write(message);
  const own = Logger.create();
  own.write(message);
  return shared.lines[shared.lines.length - 1] + " | " + own.lines.join() + " | " + own.format("direct");
}

export const early = use("while the modules load");
