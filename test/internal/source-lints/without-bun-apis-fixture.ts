// Preload for without-bun-apis.ts. It replaces each function on the Bun object
// with one that throws. DISABLED_BUN_APIS=a,b limits this to the named functions.
const only = process.env.DISABLED_BUN_APIS ? new Set(process.env.DISABLED_BUN_APIS.split(",")) : undefined;

for (const key of Object.getOwnPropertyNames(Bun)) {
  if (only && !only.has(key)) continue;
  const desc = Object.getOwnPropertyDescriptor(Bun, key);
  if (!desc?.writable || typeof desc.value !== "function") continue;
  (Bun as unknown as Record<string, unknown>)[key] = () => {
    throw new Error(`Bun.${key} is disabled: build scripts must use node: APIs`);
  };
}
