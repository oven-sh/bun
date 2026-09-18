// usage: bun epipe-fixture.ts <ls|mkdir|rm|subprocess> <name>...
import { $ } from "bun";
import { rmSync, writeFileSync, writeSync } from "node:fs";

const [command, ...names] = process.argv.slice(2);

function start() {
  switch (command) {
    case "ls":
      return $`ls -d ${names}`;
    case "mkdir":
      for (const name of names) rmSync(name, { recursive: true, force: true });
      return $`mkdir -v ${names}`;
    case "rm":
      for (const name of names) writeFileSync(name, "");
      return $`rm -v ${names}`;
    case "subprocess":
      return $`head -c 1048576 /dev/zero`;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

// The test closes the read end of stdout right after the spawn. Wait until a write fails.
while (true) {
  try {
    writeSync(1, "still has a reader\n");
  } catch (e) {
    if (e.code === "EPIPE") break;
    if (e.code !== "EAGAIN") throw e;
  }
  await Bun.sleep(1);
}

// Only a run with several chunks queued before the first write fails takes the path under test.
for (let run = 0; run < 10; run++) await start().nothrow();
console.error("settled");
