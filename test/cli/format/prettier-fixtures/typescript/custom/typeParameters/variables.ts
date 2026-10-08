const foo: SomeThing<boolean> = func();
const bar: SomeThing<boolean, boolean> = func();
const fooo: SomeThing<{ [P in "x" | "y"]: number }> = func();
const baar: SomeThing<K extends T ? G : S> = func();
const fooooooooooooooo: SomeThing<boolean> = looooooooooooooooooooooooooooooongNameFunc();
const baaaaaaaaaaaaaaaaaaaaar: SomeThing<boolean, boolean> = looooooooooooooooooooooooooooooongNameFunc();
const baaaaaaaaaaaaaaar: SomeThing<{ [P in "x" | "y"]: number }> = looooooooooooooooooooooooooooooongNameFunc();
const baaaaaaaaaaaaaaaar: SomeThing<K extends T ? G : S> = looooooooooooooooooooooooooooooongNameFunc();
const isAnySuccessfulAttempt$: Observable<boolean> = this._quizService.isAnySuccessfulAttempt$().pipe(
  tap((isAnySuccessfulAttempt: boolean) => {
    this.isAnySuccessfulAttempt = isAnySuccessfulAttempt;
  }),
);
const isAnySuccessfulAttempt2$: Observable<boolean> = this._someMethodWithLongName();
const fooooooooooooooo: SomeThing<boolean | string> = looooooooooooooooooooooooooooooongNameFunc();
const fooooooooooooooo: SomeThing<boolean & string> = looooooooooooooooooooooooooooooongNameFunc();
const fooooooooooooooo: SomeThing<keyof string> = looooooooooooooooooooooooooooooongNameFunc();
const fooooooooooooooo: SomeThing<string[]> = looooooooooooooooooooooooooooooongNameFunc();
const fooooooooooooooo: SomeThing<string["anchor"]> = looooooooooooooooooooooooooooooongNameFunc();
