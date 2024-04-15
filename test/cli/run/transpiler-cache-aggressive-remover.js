import { rmSync } from "fs";

while (1) {
  try {
    rmSync(process.argv[2], { recursive: true, force: true });
  } catch (error) {}
}
