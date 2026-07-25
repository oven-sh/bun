import { $, which } from "bun";

const cmd = which("true");

const promises = [];

// The caller sizes the outer loop based on build type. Under ASAN/debug the
// parent is slower relative to the native child, so the "exited before watch()"
// race this fixture was written for is hit with far fewer iterations than a
// release build needs.
const upperCount = parseInt(process.env.SHELL_LOAD_OUTER, 10) || (process.platform === "darwin" ? 100 : 300);

for (let j = 0; j < upperCount; j++) {
  for (let i = 0; i < 100; i++) {
    promises.push($`${cmd}`.text().then(() => {}));
  }
  if (j % 10 === 0) {
    await Promise.all(promises);
    promises.length = 0;
    console.count("Ran");
  }
}

await Promise.all(promises);
