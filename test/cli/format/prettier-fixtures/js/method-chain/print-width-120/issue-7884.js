    cy.get(".ready")
      .should("have.text", "READY")
      .should("have.css", "background-color", "rgb(136, 228, 229)");
    cy.get(".pending")
      .should("have.text", "PENDING")
      .should("have.css", "background-color", "rgb(253, 212, 90)");
    cy.get(".live")
      .should("have.text", "LIVE")
      .should("have.css", "background-color", "rgb(175, 221, 255)");
    cy.get(".draft")
      .should("have.text", "DRAFT")
      .should("have.css", "background-color", "rgb(255, 181, 181)");
    cy.get(".scheduled")
      .should("have.text", "SCHEDULED")
      .should("have.css", "background-color", "rgb(222, 222, 222)");
