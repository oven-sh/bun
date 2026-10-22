declare const aotRuntimeCounters: () => string;
const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]);
declare const aotOperationCount: (name: string) => number;

function hide(value: unknown): any {
    return value;
}

function measure(label: string, run: () => string | undefined): void {
    const finished = (aotOperationCount("operationAOTJSONWriterFinish") - writersFailed());
    let length = 0;
    for (let i = 0; i < 100; i++) length += run()!.length;
    console.log(label + ": " + length + " characters, " + ((aotOperationCount("operationAOTJSONWriterFinish") - writersFailed()) - finished) + " texts finished by compiled code");
}

function quote(text: string): string {
    return JSON.stringify(text);
}

function quoteOrNothing(text: string | undefined): string | undefined {
    return JSON.stringify(text);
}

function quoteAnything(value: any): string | undefined {
    return JSON.stringify(value);
}

const made = ["made", "at", "run", "time"].join(" ");
measure("a string", () => quote(made));
measure("a string with quotes", () => quote(made + '"'));
measure("16-bit text", () => quote(made + "\u4e2d"));
measure("a string or undefined", () => quoteOrNothing(made));
measure("a value without a type", () => quoteAnything(made));
measure("a String object without a type", () => quoteAnything(hide(new String(made))));
