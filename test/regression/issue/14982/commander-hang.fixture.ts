import { program } from "commander";

// loads ./commander-hang.fixture-test.ts
program.name("test").command("test", "Test command").parse();
