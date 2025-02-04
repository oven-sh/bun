import os from "os";
import { raise } from "./call-raise";

function checkSignal(signalName, args) {
  if (args.length !== 2) {
    throw new Error("Expected 2 arguments, got " + args.length);
  }
  if (args[0] !== signalName) {
    throw new Error("Expected signal name " + signalName + ", got " + args[0]);
  }

  const signalNumber = os.constants.signals[signalName];
  if (args[1] !== signalNumber) {
    throw new Error("Expected signal number " + signalNumber + ", got " + args[1]);
  }
}

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

const SIGUSR2 = os.constants.signals.SIGUSR2;

switch (process.argv.at(-1)) {
  case "SIGUSR1": {
    const signalName = process.platform === "linux" ? "SIGUSR2" : "SIGUSR1";
    const signalNumber = os.constants.signals[signalName];
    process.on(signalName, function () {
      checkSignal(signalName, arguments);
      done();
    });
    process.on(signalName, function () {
      checkSignal(signalName, arguments);
      done();
    });
    raise(signalNumber);
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
