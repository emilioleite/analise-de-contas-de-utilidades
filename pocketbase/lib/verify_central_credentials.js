// Validation helper for the PocketBase bridge. This file does not register a
// route or change authentication by itself. The server passes the HTTP client,
// Supabase URL and public key from its own configuration.
// Never log credentials, access tokens, or responses containing tokens.
module.exports = function verifyCentralCredentials(options) {
  const http = options.http
  const base = String(options.url || '').replace(/\/+$/, '')
  const key = String(options.publishableKey || '')
  const email = String(options.email || '').trim().toLowerCase()
  const password = String(options.password || '')
  if (!base || !key || !email || !password) return null

  function request(url, method, headers, body) {
    try {
      const result = http.send({ url, method, headers, body, timeout: 10 })
      if (!result || typeof result.statusCode !== 'number' || result.statusCode < 200 || result.statusCode >= 300) return null
      return typeof result.raw === 'string' ? JSON.parse(result.raw) : result.json || null
    } catch (_) {
      return null
    }
  }

  const auth = request(
    base + '/auth/v1/token?grant_type=password',
    'POST',
    { apikey: key, 'Content-Type': 'application/json' },
    JSON.stringify({ email, password }),
  )
  if (!auth || !auth.access_token || !auth.user || !auth.user.id ||
      String(auth.user.email || '').trim().toLowerCase() !== email) return null

  const uid = String(auth.user.id)
  const headers = { apikey: key, Authorization: 'Bearer ' + auth.access_token }
  const filter = '?user_uid=eq.' + encodeURIComponent(uid)
  const links = request(base + '/rest/v1/ceq_account_links' + filter + '&select=profile_id', 'GET', headers)
  const grants = request(base + '/rest/v1/ceq_effective_access' + filter + '&select=modules,active', 'GET', headers)
  if (!Array.isArray(links) || links.length !== 1 || !links[0].profile_id ||
      !Array.isArray(grants) || grants.length !== 1 || grants[0].active !== true ||
      !Array.isArray(grants[0].modules) || grants[0].modules.indexOf('analise_contas') === -1) return null

  const profiles = request(base + '/rest/v1/ceq_app_users?id=eq.' +
    encodeURIComponent(links[0].profile_id) + '&select=id,email,status', 'GET', headers)
  if (!Array.isArray(profiles) || profiles.length !== 1 ||
      profiles[0].id !== links[0].profile_id ||
      String(profiles[0].email || '').trim().toLowerCase() !== email ||
      String(profiles[0].status || '').trim().toLowerCase() !== 'ativo') return null

  return { userId: uid, profileId: String(links[0].profile_id), email }
}
