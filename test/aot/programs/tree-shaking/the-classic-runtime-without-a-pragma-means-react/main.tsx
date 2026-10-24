// The classic runtime, when no pragma names a factory, calls React.createElement and React.Fragment. `React` is a namespace import here, so two exports of react.ts are named by no text at all.
/* @jsxRuntime classic */
import * as React from "./react";

console.log(<><a>text</a></>);
