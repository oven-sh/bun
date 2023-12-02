import os from "os";
import { raise } from "./call-raise";

var counter = 0;
function done() {
  counter++;
  if (counter === 2) {
    setTimeout(() => {
      if (counter !== 2) {
        console.log(counter);
        console.log("FAIL");
        process.exit(1);
      }

      console.log("PASS");
      process.exit(0);
    }, 1);
  }
}

var counter2 = 0;
function done2() {
  counter2++;
  if (counter2 === 2) {
    setTimeout(() => {
      if (counter2 !== 2) {
        console.log(counter2);
        console.log("FAIL");
        process.exit(1);
      }

      console.log("PASS");
      process.exit(0);
    }, 1);
  }
}

const SIGUSR1 = os.constants.signals.SIGUSR1;
const SIGUSR2 = os.constants.signals.SIGUSR2;

switch (process.argv.at(-1)) {
  case "SIGUSR1": {
    process.on("SIGUSR1", () => {
      done();
    });
    process.on("SIGUSR1", () => {
      done();
    });
    raise(SIGUSR1);
    break;
  }
  case "SIGUSR2": {
    process.on("SIGUSR2", () => {
      done2();
    });
    process.emit("SIGUSR2");
    raise(SIGUSR2);
    break;
  }
  default: {
    throw new Error("Unknown argument: " + process.argv.at(-1));
  }
}
