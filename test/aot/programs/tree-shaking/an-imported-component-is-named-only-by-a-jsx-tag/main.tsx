// Card and its default-exported sibling are imported and then named by tags alone. Unused is imported by nobody.
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";
import Title, { Card } from "./components";

console.log(<Card><Title text="one" /></Card>);
