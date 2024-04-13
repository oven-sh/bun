import { crash_handler } from "bun:internal-for-testing";

const approach = process.argv[2];
if (approach in crash_handler) {
  crash_handler[approach]();
} else {
  console.error("usage: bun fixture-crash.js <segfault|panic|rootError|outOfMemory>");
}
