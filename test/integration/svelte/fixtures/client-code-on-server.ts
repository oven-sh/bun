/// <reference lib="dom" />

import { SveltePlugin } from "bun-plugin-svelte";
import { Window } from "happy-dom";
import { expect } from "bun:test";

Bun.plugin(SveltePlugin({ forceSide: "client", development: true }));

const { mount } = await import("svelte");

// @ts-ignore
const window = globalThis.window = new Window({
  width: 1024,
  height: 768,
  url: "http://localhost:3000",
});


const document = globalThis.document = window.document as unknown as Document;
const body = document.body;

const root = document.body.appendChild(document.createElement("div"));

const { default: TodoApp } = await import("./todo-list.svelte");

mount(TodoApp, { target: root });
expect(root.innerHTML).not.toBeEmpty();
