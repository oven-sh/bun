// The only references to these functions stand after an @: a plain name, a call, a member of an object, a member of a namespace import, and a parenthesized expression.
import * as marks from "./marks";
import { log } from "./marks";

function plain(value: Function, context: ClassDecoratorContext): void {
  log.push("plain " + String(context.name));
}

function called(text: string) {
  return (value: Function, context: ClassDecoratorContext): void => {
    log.push("called " + text);
  };
}

function pick(): (value: Function, context: ClassDecoratorContext) => void {
  return (value, context) => {
    log.push("picked");
  };
}

@plain
@called("with text")
@marks.imported
@marks.factory("f")
@(pick())
class Target {}

console.log(log.join("\n"));
