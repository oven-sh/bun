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
    var callbackSIGUSR2 = false;
    process.on("SIGUSR2", () => {
      callbackSIGUSR2 = true;
    });
    process.emit("SIGUSR2");
    if (!callbackSIGUSR2) {
      console.log("FAIL");
      process.exit(1);
    }

    console.log("PASS");
    process.exit(0);
  }
  default: {
    throw new Error("Unknown argument: " + process.argv.at(-1));
  }
}
