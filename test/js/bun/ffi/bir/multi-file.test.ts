import { runFixtures, runProjects } from "./run-fixtures";

// Linkage: what several translation units share and what stays private to one.
runFixtures("multi-file");
runProjects("multi-file");
