import type { Greeter, Options } from "./options";
import { Mood, type Options as Moods } from "./mood";
export class Polite implements Greeter {
  private count: number = 0;
  readonly prefix: string;
  static made = 0;
  constructor(prefix: string, public mood: Mood = Mood.Happy, private moods?: Moods) {
    this.prefix = prefix;
  }
  greet(options: Options): string;
  greet(options: Options, times: number): string[];
  greet(options: Options, times?: number): string | string[] {
    this.count++;
    const text = (options.loud ? options.name.toUpperCase() : options.name) as string;
    const line = this.prefix + " " + text!;
    return times === undefined ? line : new Array<string>(times).fill(line);
  }
  get total(): number {
    return this.count + (this.moods ?? []).length;
  }
}
