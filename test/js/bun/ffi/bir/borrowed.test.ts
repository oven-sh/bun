import { runFixtures, runProjects } from "./run-fixtures";

// Other compilers' own tests, copied from their repositories: what came from where, under which licence and what
// was changed is in each directory's NOTICE.
runFixtures("borrowed/chibicc");
runFixtures("borrowed/scc");
runProjects("borrowed/projects");
