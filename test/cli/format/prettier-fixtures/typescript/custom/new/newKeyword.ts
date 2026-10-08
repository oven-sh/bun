var x: { y: new <T, U> () => [T, U] };

interface I {
    new <T>(x: string);
    new (x: string);
    new (x: number): number;
}
