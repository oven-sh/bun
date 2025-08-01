import { Command } from "commander";

new Command("test")
  .action(() => {
    console.log("Test command");
    process.exit(0);
  })
  .parse();
