cy.get('option:first')
  .should('be.selected')
  .and('have.value', 'Metallica')

cy.get(".ready")
  .should("have.text", "FOO")
  .should("have.css", "color", "#aaa");
