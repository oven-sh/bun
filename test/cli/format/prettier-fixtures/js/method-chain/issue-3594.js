const fetched = fetch("/foo");
fetched
	.then(response => response.json())
	.then(json => processThings(json.data.things));

let column = new Column(null, conn)
    .table(data.table)
    .json(data.column);
