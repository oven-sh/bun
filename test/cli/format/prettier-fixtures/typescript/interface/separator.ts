declare module 'selenium-webdriver' {
  export const until: {
    ableToSwitchToFrame(frame: number | WebElement | By): Condition<boolean>;
    alertIsPresent(): Condition<Alert>;
  };
}

export interface Edge {
  cursor: {};
  node: {
    id: {};
  };
}

interface Test { one: string, two: any[] }
