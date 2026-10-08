if (testConfig.ENABLE_ONLINE_TESTS === "true") {
  describe("POST /users/me/pet", function() {
    it("saves pet", function() {
      function assert(pet) {
        expect(pet).to.have.property("OwnerAddress").that.deep.equals({
          AddressLine1: "Alexanderstrasse",
          AddressLine2: "",
          PostalCode: "10999",
          Region: "Berlin",
          City: "Berlin",
          Country: "DE"
        });
      }
    });
  });
}

wrapper.find('SomewhatLongNodeName').prop('longPropFunctionName')().then(function() {
  doSomething();
});

wrapper.find('SomewhatLongNodeName').prop('longPropFunctionName')('argument').then(function() {
  doSomething();
});

wrapper.find('SomewhatLongNodeName').prop('longPropFunctionName', 'second argument that pushes this group past 80 characters')('argument').then(function() {
  doSomething();
});

wrapper.find('SomewhatLongNodeName').prop('longPropFunctionName')('argument', 'second argument that pushes this group past 80 characters').then(function() {
  doSomething();
});
