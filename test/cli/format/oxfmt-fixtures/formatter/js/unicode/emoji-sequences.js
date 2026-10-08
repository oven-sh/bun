//345678901234567890123456789012345678901234567890123456789012345678901234567890
//                                                                           80|
export async function deleteTestWorkspaceAPI() {
  // THIS SHOULD BREAK WITH PRINT WIDTH 80
  console.log(`🗑️ DELETED => TEST WORKSPACE on ${baseURL} (Team ID: ${teamId})`);
}
export async function deleteTestWorkspaceAPI2() {
  // THIS SHOULD NOT BREAK WITH PRINT WIDTH 80
  console.log(`🗑️ DELETE => TEST WORKSPACE on ${baseURL} (Team ID: ${teamId})`);
}

// Emoji with variation selector (U+1F5D1 + U+FE0F) has width 2, not 1.
// const _ = "..."; = 13 chars
// + 34 emojis = width 68,
// Total 81 chars, should break with `printWidth: 80`.
const _ = "🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️🗑️";
