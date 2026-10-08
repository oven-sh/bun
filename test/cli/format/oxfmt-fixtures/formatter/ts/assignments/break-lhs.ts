{
  let { className, unfurl: unfurlAttrr, ...attrs } = getAttributesFromNode(node);

  ({ className, unfurl: unfurlAttrr, ...attrs } = { className: "name", unfurl: "unfurl", others: [1, 2, 3]});
};
