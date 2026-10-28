// Where every function counts as hot, a function that only calls JSON.stringify on a record is inlined into its entry point, so the entry point calls the
// record's serializer. The step that decides which entry points need a stack check asks what such a call may do, and to answer it makes a type of its own.
// It runs beside the step that gives the field accesses their types. The build aborted where the second began while the first held such a type:
// on two threads or more, most of the time.
import { programsBuiltWith } from "./run-programs";

const hot = "--aot-heat=everything-is-hot";
const only = ["json-stringify-generated-records-2"];
programsBuiltWith("typed-objects", "every-function-hot", [hot], {}, 1, 1, only);
for (const threads of [2, 3, 4, 6, 8, 12, 16])
  programsBuiltWith(
    "typed-objects",
    `every-function-hot-on-${threads}-threads`,
    [hot, `--aot-threads=${threads}`],
    {},
    1,
    1,
    only,
  );
