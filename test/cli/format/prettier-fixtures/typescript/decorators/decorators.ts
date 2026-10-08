export class TestTextFileService {
	constructor(
		@ILifecycleService lifecycleService,
	) {
	}
}

@commonEditorContribution
export class TabCompletionController {
}

@Component({
  selector: 'angular-component',
})
class AngularComponent {
  @Input() myInput: string;
}

class Class {
  method(
    @Decorator
    { prop1, prop2 }: Type
  ) {
    doSomething();
  }
}

class Class2 {
  method(
    @Decorator1
    @Decorator2
    { prop1, prop2 }: Type
  ) {
    doSomething();
  }
}

class Class3 {
  method(
    @Decorator
    { prop1_1, prop1_2 }: Type,
    { prop2_1, prop2_2 }: Type
  ) {
    doSomething();
  }
}

class Class4 {
  method(
    param1,
    @Decorator
    { prop1, prop2 }: Type
  ) {}
}

class Class5 {
  method(
    @Decorator { prop1 }: Type
  ) {}
}

class Class6 {
  method(
    @Decorator({}) { prop1 }: Type
  ) {}
  method(
    @Decorator(
      {}) { prop1 }: Type
  ) {}
  method(
    @Decorator([]) { prop1 }: Type
  ) {}
  method(
    @Decorator(
      []) { prop1 }: Type
  ) {}
}
