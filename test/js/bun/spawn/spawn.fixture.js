import fs from "fs";
const [command, argument] = process.argv.slice(2);

try {
  switch (command) {
    case "sleep":
      Bun.sleepSync(parseFloat(argument || "0") * 1000);
      break;
    case "echo": {
      console.log(argument || "");
      break;
    }
    case "printenv": {
      console.log(process.env[argument] || "");
      break;
    }
    case "false": {
      process.exit(1);
    }
    case "true": {
      process.exit(0);
    }
    case "cat": {
      if (fs.existsSync(argument)) {
        // cat file
        const writer = Bun.stdout.writer();
        writer.write(fs.readFileSync(argument));
        writer.flush();
      } else if (typeof argument == "string") {
        // cat text
        const writer = Bun.stdout.writer();
        writer.write(argument);
        writer.flush();
      } else {
        // echo
        const writer = Bun.stdout.writer();
        writer.write(await Bun.readableStreamToText(Bun.stdin));
        writer.flush();
      }
    }
    default:
      break;
  }
} catch {}
