"use strict";
const tasks = [];
let ticks = 0;
exports.unstable_ImmediatePriority = 1;
exports.unstable_UserBlockingPriority = 2;
exports.unstable_NormalPriority = 3;
exports.unstable_LowPriority = 4;
exports.unstable_IdlePriority = 5;
exports.unstable_now = () => ++ticks;
exports.unstable_shouldYield = () => false;
exports.unstable_requestPaint = () => {};
exports.unstable_scheduleCallback = (priority, callback) => {
  const task = { priority, callback };
  tasks.push(task);
  return task;
};
exports.unstable_cancelCallback = task => {
  task.callback = null;
};
exports.flush = () => {
  while (tasks.length) {
    tasks.sort((a, b) => a.priority - b.priority);
    const task = tasks.shift();
    const callback = task.callback;
    if (!callback) continue;
    task.callback = null;
    const more = callback(false);
    if (typeof more === "function") {
      task.callback = more;
      tasks.push(task);
    }
  }
};
