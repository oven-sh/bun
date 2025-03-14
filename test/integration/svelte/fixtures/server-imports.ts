import { render } from "svelte/server";
import { expect } from "bun:test";
import TodoApp from "./todo-list.svelte";

expect(TodoApp).toBeTypeOf("function");

const result = render(TodoApp);
expect(result).toMatchObject({ head: expect.any(String), body: expect.any(String) });
expect(result.body).not.toBeEmpty();
