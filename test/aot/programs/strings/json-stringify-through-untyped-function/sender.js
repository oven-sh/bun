export class Sender {
  sent = 0;
  json = (object, status) => {
    const body = JSON.stringify(object);
    this.sent += body.length;
    return { status: status ?? 200, body };
  };
}
