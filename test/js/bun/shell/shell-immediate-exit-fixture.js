import { $, which } from "bun";

const cmd = which("true");

const promises = [];

const upperCount = process.platform === "darwin" ? 100 : 300;

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
