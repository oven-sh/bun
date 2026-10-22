export { Level as Rank, Bit } from "./levels.ts";
import { Level } from "./levels.ts";

export const kept: Level[] = [Level.Low, Level.High, Level.Text];
export function isHigh(level: Level): boolean {
  return level === Level.High;
}
