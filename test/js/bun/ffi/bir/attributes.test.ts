import { runFixtures, runProjects } from "./run-fixtures";

// Attributes that change layout or meaning (aligned, packed, cleanup, asm labels, ...) and volatile objects.
runFixtures("attributes");
runProjects("attributes");
