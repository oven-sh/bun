class Foo {
    constructor(
        @inject(Bar)
        private readonly bar: IBar,

        @inject(MyProcessor)
        private readonly myProcessor: IMyProcessor,

        @inject(InjectionTypes.AnotherThing)

        private readonly anotherThing: IAnotherThing | undefined,
    ) { }
}
