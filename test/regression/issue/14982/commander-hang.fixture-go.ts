import { Command } from "commander";

new Command("go")
  .action(() => {
    console.log("Test command");
    process.exit(0);
  })
  .parse();
