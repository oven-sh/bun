import { mount } from "svelte";
import App from "./App.svelte";
// import App from "../todo-list.svelte";

declare const document: any;

const root = document.body.appendChild(document.createElement("div"));
mount(App, { target: root });
