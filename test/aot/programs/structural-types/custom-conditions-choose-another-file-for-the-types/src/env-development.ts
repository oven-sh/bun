console.log("env-development ran");

export const level: number = 1;

export function describe(): string {
  return "development";
}

export class Logger {
  lines: string[] = [];
  write(line: string): number {
    return this.lines.push(line);
  }
}
