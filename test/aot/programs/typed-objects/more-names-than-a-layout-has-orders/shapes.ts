export class Options {
  declare host?: string;
  declare port?: number;
  always = 1;
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
  }
}
