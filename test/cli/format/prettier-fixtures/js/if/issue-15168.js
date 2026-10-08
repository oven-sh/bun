for (const division of collidingDivisions) {
	if (!division.properties.canRemove) {
		if (division.canContainSingleParagraph(startParagraph)) continue; // selection starting in r/o div: always OK to delete
		else if (endParagraph !== division.endParagraph && division.canContainSingleParagraph(endParagraph)) continue; // selection ending in r/o div: OK to delete IF it is NOT last paragraph (which would get absorbed)
		else { // selection over whole r/o div OR ending in last paragraph (which would get absorbed) -> FAIL
			console.warn('deleteSelectedTextAndJoinRemainingNodes(): cannot delete because of must-keep division: ' + division.properties.name);
		}
	}
}
