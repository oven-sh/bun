import { render } from "../react-stand-in/render";
import { useLabel, View } from "./View.jsx";

for (const a of [1, 1, 2]) console.log(render(View, { a }), JSON.stringify(render(useLabel, a)));
