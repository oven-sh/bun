export class Logger {
  lines: string[] = [];
  prefix = "log";
  format(message: string): string {
    return this.prefix + ": " + message;
  }
  write(message: string): number {
    return this.lines.push(this.format(message));
  }
  static create(): Logger {
    return new Logger();
  }
}

export const shared = Logger.create();
