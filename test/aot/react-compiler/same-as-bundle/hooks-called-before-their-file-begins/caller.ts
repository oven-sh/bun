import { render } from "../react-stand-in/render";
import { useChoice, useList } from "./hooks";

function attempt(call: () => unknown) {
  try {
    return JSON.stringify(call());
  } catch (error) {
    return (error as Error).name;
  }
}

export const early = [
  attempt(() => render(useList, undefined)),
  attempt(() => render(useChoice, { isFirst: true, first: 1, second: 2 })),
  attempt(() => render(useChoice, { isFirst: false, first: 1, second: 2 })),
].join(" ");
