export function format(value: number): string;
export function format(value: string): string;
export function format(value: number | string): string { return "format " + typeof value; }

export function parse(text: string): string;
export function parse(value: number): string;
export function parse(value: unknown): string { return "parse " + typeof value; }

export function measure(list: unknown[]): string;
export function measure(text: string): string;
export function measure(value: { length: number }): string { return "measure " + value.length; }

export default function build(): string;
export default function build(value: number): string;
export default function build(value?: number): string { return "build " + value; }
