console.log("env-production ran");

export const level: string = "silent";

export function describe(): number {
  return 0;
}

export class Logger {
  dropped = 0;
  write(line: string): string {
    this.dropped++;
    return "dropped " + line;
  }
}
