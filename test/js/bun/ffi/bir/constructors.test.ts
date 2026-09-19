import { runFixtures, runProjects } from "./run-fixtures";

// __attribute__((constructor)) and destructor functions run around main, in priority order.
runFixtures("constructors");
runProjects("constructors");
