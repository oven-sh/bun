export interface User {
  id: number;
  name: string;
  role: "admin" | "member";
  token: string;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  status: "open" | "done";
  priority: number;
  assigneeId: number;
  tags: string[];
}

export interface NewTask {
  title: string;
  priority: number;
  assigneeId: number;
  tags: string[];
  note?: string;
}

export interface TaskView {
  id: number;
  title: string;
  status: string;
  priority: number;
  assignee: string;
  tags: string[];
}

export interface TaskPage {
  projectId: number;
  requestedBy: string;
  total: number;
  tasks: TaskView[];
}

export interface Created {
  id: number;
  projectId: number;
  title: string;
  priority: number;
  assignee: string;
  tagCount: number;
  createdBy: string;
}

export interface Failure {
  error: string;
  requestId: string;
}

export class ApiError extends Error {
  status: 400 | 401 | 403 | 404;
  constructor(status: 400 | 401 | 403 | 404, message: string) {
    super(message);
    this.status = status;
  }
}

const usersByToken = new Map<string, User>();
const usersById = new Map<number, User>();
const tasksByProject = new Map<number, Task[]>();

for (let id = 1; id <= 20; id++) {
  const user: User = { id, name: `User ${id}`, role: id % 5 === 0 ? "admin" : "member", token: `token-${id}` };
  usersByToken.set(user.token, user);
  usersById.set(id, user);
}
for (let projectId = 1; projectId <= 10; projectId++) {
  const tasks: Task[] = [];
  for (let n = 1; n <= 30; n++) {
    tasks.push({
      id: projectId * 100 + n,
      projectId,
      title: `Task ${n} of project ${projectId}`,
      status: n % 3 === 0 ? "done" : "open",
      priority: 1 + (n % 4),
      assigneeId: 1 + (n % 20),
      tags: n % 2 === 0 ? ["backend", "urgent"] : ["frontend"],
    });
  }
  tasksByProject.set(projectId, tasks);
}

export function findUserByToken(token: string): User | undefined {
  return usersByToken.get(token);
}

function viewOf(task: Task): TaskView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee: usersById.get(task.assigneeId)?.name ?? "nobody",
    tags: task.tags,
  };
}

function tasksOf(projectId: number): Task[] {
  const tasks = tasksByProject.get(projectId);
  if (!tasks) throw new ApiError(404, `no project ${projectId}`);
  return tasks;
}

export function parseId(text: string): number {
  const id = Number(text);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "not an id");
  return id;
}

export function loadTask(projectId: number, taskId: number): TaskView {
  for (const task of tasksOf(projectId)) if (task.id === taskId) return viewOf(task);
  throw new ApiError(404, `no task ${taskId}`);
}

export function loadTaskPage(user: User, projectId: number, status: string | null | undefined, limitText: string | null | undefined): TaskPage {
  const limit = limitText ? Math.min(parseId(limitText), 50) : 10;
  const matching = tasksOf(projectId).filter((task) => !status || task.status === status);
  return { projectId, requestedBy: user.name, total: matching.length, tasks: matching.slice(0, limit).map(viewOf) };
}

export function createTask(user: User, projectId: number, task: NewTask): Created {
  tasksOf(projectId);
  if (task.title.length < 1 || task.title.length > 80) throw new ApiError(400, "bad title");
  if (!Number.isInteger(task.priority) || task.priority < 1 || task.priority > 4) throw new ApiError(400, "bad priority");
  const assignee = usersById.get(task.assigneeId);
  if (!assignee) throw new ApiError(400, "no such assignee");
  if (task.tags.length > 8) throw new ApiError(400, "too many tags");
  return {
    id: projectId * 100 + 99,
    projectId,
    title: task.title,
    priority: task.priority,
    assignee: assignee.name,
    tagCount: task.tags.length,
    createdBy: user.name,
  };
}
