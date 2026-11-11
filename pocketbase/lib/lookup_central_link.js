// Draft: resolve an explicitly approved central UID to an existing PB record.
// No email-based fallback and no record creation. Never logs credentials.
// The collection is unavailable until the separate draft migration is adopted.
module.exports = function lookupCentralLink(app, centralUserId) {
  if (typeof centralUserId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(centralUserId)) return null
  try {
    const link = app.findFirstRecordByFilter('central_account_links',
      'central_user_id = {:uid}', { uid: centralUserId })
    if (!link || link.getString('central_user_id') !== centralUserId) return null
    const userId = link.getString('pocketbase_user')
    if (!userId) return null
    const user = app.findRecordById('_pb_users_auth_', userId)
    if (!user || user.id !== userId) return null
    return { id: user.id, centralUserId, email: user.getString('email'), status: user.getString('status') }
  } catch (_) {
    return null
  }
}
