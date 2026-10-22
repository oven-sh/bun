import { Logger } from "./logger.ts";

const format = Logger.prototype.format;
const create = Logger.create;

Logger.prototype.format = function (message) {
  return "[" + format.call(this, message) + "]";
};

Logger.create = () => {
  const made = create();
  made.prefix = "plugin";
  return made;
};

export function remove(): void {
  Logger.prototype.format = format;
  Logger.create = create;
}
