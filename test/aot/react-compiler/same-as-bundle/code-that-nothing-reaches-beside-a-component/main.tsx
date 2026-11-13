import { render } from "../react-stand-in/render";
import { useArrow } from "./an-arrow-function-in-front.jsx";
import { useLabel } from "./a-function-behind.jsx";
import { useFirst, useSecond } from "./between-two.jsx";
import { useRequired } from "./a-function-in-front.jsx";

for (const a of [1, 1, 2]) {
  console.log(JSON.stringify([render(useLabel, a), render(useArrow, a), render(useFirst, a), render(useSecond, a), render(useRequired, a)]));
}
