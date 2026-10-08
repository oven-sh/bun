type Keys = 'option1' | 'option2';
type A = { [K in Keys] };
type B = { [K in Keys]+? };
