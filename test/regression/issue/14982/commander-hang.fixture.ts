import { program } from "commander";

// loads ./commander-hang.fixture-go.ts
program.name("test").command("go", "Test command").parse();
