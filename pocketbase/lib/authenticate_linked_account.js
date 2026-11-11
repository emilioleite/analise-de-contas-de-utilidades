// Draft adapter only: not registered as a PocketBase hook.
// lookupLinkedRecord must use an administrator-approved immutable central UID
// mapping; matching by email alone is not sufficient.
module.exports = function authenticateLinkedAccount(options) {
  const identity = options.verify({
    http: options.http, url: options.url, publishableKey: options.publishableKey,
    email: options.email, password: options.password,
  })
  if (!identity) return null
  const record = options.lookupLinkedRecord(identity.userId)
  if (!record || !record.id || String(record.centralUserId || '') !== identity.userId ||
      String(record.email || '').trim().toLowerCase() !== identity.email ||
      record.status !== 'active') return null
  // Keep the existing PocketBase ID and role; never derive privileges from
  // writable public profile fields. Token creation is handled separately.
  return { recordId: record.id, centralUserId: identity.userId }
}
