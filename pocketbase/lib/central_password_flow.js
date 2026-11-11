// Draft adapter only; not registered as a hook.
// All supplied functions execute on the server. No local-password fallback.
module.exports = function centralPasswordFlow(options) {
  const identity = options.verify({
    http: options.http, url: options.url, publishableKey: options.publishableKey,
    email: options.email, password: options.password,
  })
  if (!identity) return null
  const outcome = options.provision({ identity, transaction: options.transaction })
  if (!outcome || !outcome.recordId) return null
  // Confirm link and PB account again; never trust an email-only association.
  const linked = options.lookup(identity.userId)
  if (!linked || linked.id !== outcome.recordId ||
      linked.centralUserId !== identity.userId ||
      String(linked.email || '').trim().toLowerCase() !== identity.email ||
      linked.status !== 'active') return null
  return options.loadRecord(outcome.recordId)
}
