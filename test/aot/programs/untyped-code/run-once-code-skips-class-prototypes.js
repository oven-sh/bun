// Code that runs once asks classes for their members too: the top level of a module, a function called once. The prototype of a class answers before it has made its members, however many names are asked.
class Service {
  name = "service"; port = 80;
  start() { return "started " + this.name; }
  stop() { return "stopped " + this.name; }
  restart() { return "restarted"; }
  status() { return "up"; }
  reload() { return "reloaded"; }
  describe() { return "a service"; }
  get address() { return "localhost:" + this.port; }
  set address(text) { this.port = Number(text.split(":")[1]); }
}
class Database extends Service {
  name = "database"; port = 5432;
  query(text) { return "rows of " + text; }
  status() { return "ready"; }
}
const service = new Service();
const database = new Database();
console.log(service.start(), service.stop(), service.restart(), service.status(), service.reload(), service.describe(), service.address);
console.log(database.start(), database.stop(), database.restart(), database.status(), database.reload(), database.describe(), database.address, database.query("users"));
console.log(typeof service.then, typeof database.then, service.missing, database.missing, typeof service.toString, typeof database.hasOwnProperty, service.toString(), database.hasOwnProperty("port"));
console.log(service.constructor === Service, database.constructor === Database, service.constructor.name, database.constructor.name);

// Whoever looks at a prototype finds everything there.
console.log(Object.getOwnPropertyNames(Service.prototype).join(), Object.getOwnPropertyNames(Database.prototype).join());
console.log(service.start === Service.prototype.start, database.start === Service.prototype.start, database.status === Database.prototype.status, database.status !== service.status);
Service.prototype.start = function () { return "started otherwise"; };
Database.prototype.missing = "found";
console.log(service.start(), database.start(), service.missing, database.missing);
database.address = "remote:9000";
console.log(database.address, database.port);
