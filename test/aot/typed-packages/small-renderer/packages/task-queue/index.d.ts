/** The lower the priority, the sooner the task runs. It is handed its priority. */
export function addTask(priority: number, run: (priority: number) => void): void;
export function runTasks(): void;
