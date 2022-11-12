export function bunExe() {
  if (Bun.version.includes("debug")) {
    return "bun-debug";
  }

  return "bun";
}
