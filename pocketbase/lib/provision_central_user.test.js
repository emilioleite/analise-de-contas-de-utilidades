const { test, expect } = require('bun:test')
const provision = require('./provision_central_user')
function fixture({ link = null, emailExists = false, failLink = false } = {}) {
  let writes = []
  const transaction = (fn) => {
    const pending = []
    const tx = {
      findLink: () => link,
      findUserByEmail: () => emailExists ? { id: 'legacy' } : null,
      createUser: (data) => { pending.push({ type: 'user', ...data }); return { id: 'new' } },
      createLink: (data) => { if (failLink) throw new Error('offline'); pending.push({ type: 'link', ...data }) },
    }
    const result = fn(tx)
    writes = pending
    return result
  }
  return { transaction, writes: () => writes }
}
const identity = { userId: 'central', email: 'new@example.com' }
test('creates user and link together with non-admin role', () => {
  const fixtureData = fixture()
  expect(provision({ identity, transaction: fixtureData.transaction })).toEqual({ recordId: 'new', created: true })
  expect(fixtureData.writes()).toEqual([{ type: 'user', email: identity.email, role: 'user', status: 'active' }, { type: 'link', centralUserId: 'central', recordId: 'new' }])
})
test('does not claim an existing email or replace an existing link', () => {
  const conflict = fixture({ emailExists: true })
  expect(provision({ identity, transaction: conflict.transaction })).toBeNull()
  expect(conflict.writes()).toEqual([])
  const linked = fixture({ link: { recordId: 'legacy' } })
  expect(provision({ identity, transaction: linked.transaction })).toEqual({ recordId: 'legacy', created: false })
  expect(linked.writes()).toEqual([])
})
test('link failure rolls back the new user in the transaction contract', () => {
  const failing = fixture({ failLink: true })
  expect(() => provision({ identity, transaction: failing.transaction })).toThrow()
  expect(failing.writes()).toEqual([])
})
