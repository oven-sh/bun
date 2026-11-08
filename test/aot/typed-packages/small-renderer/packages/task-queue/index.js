// A package without an "aot" condition: it is compiled from its JavaScript.
const tasks = [];

export function addTask(priority, run) {
  tasks.push({ priority, run });
}

export function runTasks() {
  while (tasks.length) {
    tasks.sort((a, b) => a.priority - b.priority);
    const task = tasks.shift();
    task.run(task.priority);
  }
}
