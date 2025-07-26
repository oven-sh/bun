import { expect } from "bun:test";

try {
  expect("a\nb\nc\n d\ne").toEqual("a\nd\nc\nd\ne");
} catch (e) {
  console.log(e.message);
}

const a = {
  age: 25,
  name: "Alice",
  logs: [
    "Entered the building",
    "Checked in at reception",
    "Took elevator to floor 3",
    "Attended morning meeting",
    "Started working on project",
  ],
};

const b = {
  age: 30,
  name: "Bob",
  logs: [
    "Logged into system",
    "Accessed dashboard",
    "Reviewed daily reports",
    "Updated project status",
    "Sent status email to team",
    "Scheduled follow-up meeting",
  ],
};
try {
  expect(a).toEqual(b);
} catch (e) {
  console.log(e.message);
}
