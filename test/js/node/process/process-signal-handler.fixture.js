import { raise } from "./call-raise";

function done() {
  console.log("PASS");
  process.exit(0);
}

const SIGUSR1 = {
  ["linux"]: 10,
  ["darwin"]: 30,
  ["win32"]: 16,
}[process.platform];

switch (process.argv.at(-1)) {
  case "SIGUSR1": {
    process.on("SIGUSR1", () => {
      done();
    });
    raise(SIGUSR1);
    break;
  }
  default: {
    throw new Error("Unknown argument: " + process.argv.at(-1));
  }
}
