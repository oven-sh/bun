import { flowRight } from "lodash";

const foo = flowRight(
  x => x + 1,
  x => x * 3,
  x => x - 6,
);

foo(6);

import * as _ from "lodash";

const bar = _.flowRight(
  x => x + 1,
  x => x * 3,
  x => x - 6,
);

bar(6);
