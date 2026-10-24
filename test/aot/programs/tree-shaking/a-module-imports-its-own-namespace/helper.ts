import * as entry from "./main";

export function callEntry(name: string): string {
  return "helper: " + (entry as Record<string, any>)[name]();
}
