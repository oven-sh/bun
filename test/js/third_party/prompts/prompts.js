import prompt from "prompts";

const questions = [
  {
    type: "text",
    name: "twitter",
    message: `What's your twitter handle?`,
    format: v => `@${v}`,
  },
  {
    type: "number",
    name: "age",
    message: "How old are you?",
    validate: value => (value < 18 ? `Sorry, you have to be 18` : true),
  },
  {
    type: "password",
    name: "secret",
    message: "Tell me a secret",
  },
];

const answers = await prompt(questions);

console.log(answers);
