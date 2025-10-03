test.each(Array.from({ length: 10 }, () => 0))("passing", () => {});
test.skip.each(Array.from({ length: 10 }, () => 0))("skipped", () => {});
test.failing.each(Array.from({ length: 10 }, () => 0))("failing", () => {});
test.todo.each(Array.from({ length: 10 }, () => 0))("todo", () => {});
