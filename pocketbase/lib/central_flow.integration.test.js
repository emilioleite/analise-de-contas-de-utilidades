const { expect, test } = require('bun:test')
const verify = require('./verify_central_credentials')
const provision = require('./provision_central_user')
const flow = require('./central_password_flow')
const uid = '11111111-1111-4111-8111-111111111111'
function run({ allowed = true, existingEmail = false } = {}) {
  let writes = []
  const records = [
    { access_token: 'token', user: { id: uid, email: 'user@example.com' } },
    [{ profile_id: 'profile' }],
    [{ active: true, modules: allowed ? ['analise_contas'] : ['leitor_qr'] }],
    [{ id: 'profile', email: 'user@example.com', status: 'ativo' }],
  ]
  let n = 0
  const http = { send() { return { statusCode: 200, raw: JSON.stringify(records[n++]) } } }
  let link = null
  const transaction = (fn) => fn({
    findLink: () => link,
    findUserByEmail: () => existingEmail ? { id: 'legacy' } : null,
    createUser: (data) => { writes.push(data); return { id: 'pb-new' } },
    createLink: (data) => { link = data },
  })
  const result = flow({
    verify, provision, transaction, http,
    url: 'https://example.test', publishableKey: 'public', email: 'user@example.com', password: 'secret',
    lookup: () => link ? { id: link.recordId, centralUserId: link.centralUserId, email: 'user@example.com', status: 'active' } : null,
    loadRecord: (id) => ({ id }),
  })
  return { result, writes }
}
test('central account with group access can obtain linked PB identity', () => {
  const { result, writes } = run()
  expect(result).toEqual({ id: 'pb-new' })
  expect(writes).toHaveLength(1)
  expect(writes[0].role).toBe('user')
})
test('group without access does not create a PB account', () => {
  const { result, writes } = run({ allowed: false })
  expect(result).toBeNull()
  expect(writes).toHaveLength(0)
})
test('existing email conflict does not seize PB account', () => {
  const { result, writes } = run({ existingEmail: true })
  expect(result).toBeNull()
  expect(writes).toHaveLength(0)
})
