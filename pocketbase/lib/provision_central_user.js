// Draft provisioning contract. Not wired to PocketBase hooks.
// Must be called only after central credential and group verification.
// The supplied transaction must atomically create both the PB user and link.
module.exports = function provisionCentralUser(options) {
  const identity = options.identity
  if (!identity || !identity.userId || !identity.email) return null
  return options.transaction((tx) => {
    const existingLink = tx.findLink(identity.userId)
    if (existingLink) return { recordId: existingLink.recordId, created: false }
    // Never claim an existing PB user by email; administrator must review it.
    if (tx.findUserByEmail(identity.email)) return null
    const record = tx.createUser({ email: identity.email, role: 'user', status: 'active' })
    if (!record || !record.id) throw new Error('Unable to create PB user')
    tx.createLink({ centralUserId: identity.userId, recordId: record.id })
    return { recordId: record.id, created: true }
  })
}
