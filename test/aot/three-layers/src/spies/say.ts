import { test } from "bun:test";
export function say(file: string, name: string, body: () => unknown): void {
  test(name, async () => { let text: string; try { text = JSON.stringify(await body()); } catch (error) { text = "THROWS " + (error as Error).name + ": " + String((error as Error).message).slice(0, 70); } console.log("RESULT|" + file + "|" + name + "|once|" + text); });
}
