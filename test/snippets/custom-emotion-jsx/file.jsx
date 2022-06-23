import * as ReactDOM from "react-dom";
export const Foo = () => <div css={{ content: '"it worked!"' }}></div>;

export function test() {
  const element = document.createElement("div");
  element.id = "custom-emotion-jsx";
  document.body.appendChild(element);
  ReactDOM.render(<Foo />, element);
  const style = window.getComputedStyle(element.firstChild);
  if (!(style["content"] ?? "").includes("it worked!")) {
    throw new Error('Expected "it worked!" but received: ' + style["content"]);
  }

  return testDone(import.meta.url);
}
