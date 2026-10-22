import * as entry from "./main";

export async function viaImportCall() {
  const module: Record<string, any> = await import("./main");
  return [module.first(), module["sec" + "ond"](), new module.Third().name(), module.default()].join(", ");
}

export function viaNamespace() {
  return Object.keys(entry).sort().join();
}
