export declare const expectType: <T>(expression: T) => void;
export declare const expectAssignable: <T>(expression: T) => void;
export declare const expectNotAssignable: <T>(expression: any) => void;
export declare const expectTypeEquals: <T, S>(expression: T extends S ? (S extends T ? true : false) : false) => void;
