// `text.substring(start, end)` over variables of a closure that untyped code also fills. The method is read before its arguments, and only the paths behind a failed test of an argument call it by value:
// on each of them it is the built-in method, with the receiver and the arguments that plain Bun hands it.
function createScanner(initial: string) {
  var text: string = initial, pos: number = 0, end: number = initial.length, start: number = 0;
  return {
    setText(t: string): void { text = t; pos = 0; end = t.length; },
    setStart(p: number): void { start = p; },
    setPos(p: number): void { pos = p; },
    word(): string {
      while (pos < end) { const ch = text.charCodeAt(pos); if (ch >= 97 && ch <= 122) pos++; else break; }
      return text.substring(start, pos);
    },
    cut(): string { return text.slice(start, pos) + "|" + text.indexOf("a", start) + "|" + text.padEnd(pos, "."); },
  };
}
const parsed: any = JSON.parse('{"text":"alpha beta","zero":0,"two":"2","none":null}');
const scanner = createScanner("none");
let length = 0;
for (let turn = 0; turn < 20000; ++turn) {
  scanner.setText(parsed.text);
  scanner.setStart(parsed.zero);
  length = (length + scanner.word().length + scanner.cut().length) | 0;
}
console.log(length);

const loose: any = scanner;
const log: string[] = [];
const counted = (name: string, value: number) => ({ valueOf() { log.push(name); return value; } });
loose.setStart(parsed.two); console.log(scanner.word(), scanner.cut());
loose.setStart(parsed.none); console.log(scanner.word(), scanner.cut());
loose.setStart(undefined); console.log(scanner.word(), scanner.cut());
loose.setStart(counted("start", 1)); console.log(scanner.word(), scanner.cut(), log.join());
loose.setStart(0); loose.setPos(counted("pos", 3)); console.log(scanner.word(), log.join());
loose.setStart(counted("start", 1)); loose.setPos("4"); console.log(scanner.word(), scanner.cut(), log.join());
loose.setText({ length: 3, charCodeAt() { return 0; }, substring(a: unknown, b: unknown) { return "own substring " + String(a) + " " + String(b); }, slice() { return "own slice"; }, indexOf() { return -2; }, padEnd() { return "own padEnd"; } });
loose.setStart(1); console.log(scanner.word(), scanner.cut());
loose.setText(12345); try { console.log(scanner.word()); } catch (error) { console.log((error as Error).constructor.name); }
