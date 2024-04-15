import styled from "styled-components";
import React from "react";
import ReactDOM from "react-dom";

const ErrorScreenRoot = styled.div`
  font-family:
    "Muli",
    -apple-system,
    BlinkMacSystemFont,
    Helvetica,
    Arial,
    sans-serif;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: #fff;
  text-align: center;
  background-color: #0b2988;
  color: #fff;
  font-family:
    "Muli",
    -apple-system,
    BlinkMacSystemFont,
    Helvetica,
    Arial,
    sans-serif;
  line-height: 1.5em;

  & > p {
    margin-top: 10px;
  }

  & a {
    color: inherit;
  }
`;

export function test() {
  if (typeof window !== "undefined") {
    const reactEl = document.createElement("div");
    document.body.appendChild(reactEl);
    ReactDOM.render(<ErrorScreenRoot id="error-el">The react child should have this text</ErrorScreenRoot>, reactEl);

    const style = document.querySelector("style[data-styled]");
    console.assert(style, "style tag should exist");
    console.assert(
      style.textContent.split("").every(a => a.codePointAt(0) < 128),
      "style tag should not contain invalid unicode codepoints",
    );
    console.assert(document.querySelector("#error-el").textContent === "The react child should have this text");

    ReactDOM.unmountComponentAtNode(reactEl);
    reactEl.remove();
    style.remove();
    return testDone(import.meta.url);
  }

  return testDone(import.meta.url);
}
