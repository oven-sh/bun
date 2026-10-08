(a ? b : c).d();

(a ? b : c).d().e();

(a ? b : c).d().e().f();

(valid
  ? helper.responseBody(this.currentUser)
  : helper.responseBody(this.defaultUser))
.map();

(valid
  ? helper.responseBody(this.currentUser)
  : helper.responseBody(this.defaultUser))
.map().filter();

(valid
  ? helper.responseBody(this.currentUser)
  : helper.responseBody(defaultUser))
.map();

object[valid
  ? helper.responseBody(this.currentUser)
  : helper.responseBody(defaultUser)]
.map();
