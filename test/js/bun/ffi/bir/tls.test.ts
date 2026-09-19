import { runFixtures, runProjects } from "./run-fixtures";

// _Thread_local and __thread objects: one copy per thread, initializers, addresses.
runFixtures("tls");
runProjects("tls");
