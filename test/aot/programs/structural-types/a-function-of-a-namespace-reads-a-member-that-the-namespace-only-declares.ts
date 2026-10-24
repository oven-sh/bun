namespace Tools {
  export declare let title: string;
  export function heading(): string {
    return title + "!";
  }
}

Tools.title = "stored";
console.log(Tools.heading());
