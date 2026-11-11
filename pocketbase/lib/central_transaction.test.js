const { expect, test } = require('bun:test')
const makeTransaction = require('./central_transaction')
const provision = require('./provision_central_user')
const identity = { userId: '11111111-1111-4111-8111-111111111111', email: 'user@example.com' }
function fixture({ failure = false, existing = false } = {}) {
  let saved = []
  let queries = []
  const app = { runInTransaction(fn) {
    let pending = []
    const tx = {
      findRecordsByFilter(collection, filter, sort, limit, offset, params) {
        queries.push({ collection, filter, params })
        return collection === '_pb_users_auth_' && existing ? [{ id: 'existing' }] : []
      },
      findCollectionByNameOrId(name) { return { name } },
      save(record) {
        if (failure && record.collection.name === 'central_account_links') throw new Error('fail')
        record.id = record.id || 'new-pb'
        pending.push(record)
      },
    }
    fn(tx)
    saved = pending
  } }
  const factory = (collection) => ({ collection, values: {}, set(key, value) { this.values[key] = value }, setRandomPassword() { this.randomPassword = true } })
  return { app, factory, saved: () => saved, queries: () => queries }
}
test('saves user and protected link in one transaction using random password', () => {
  const f = fixture()
  const result = provision({ identity, transaction: makeTransaction(f.app, f.factory) })
  expect(result.recordId).toBe('new-pb')
  expect(f.saved()).toHaveLength(2)
  expect(f.saved()[0].randomPassword).toBe(true)
  expect(f.saved()[0].values.role).toBe('user')
  expect(f.saved()[1].values.central_user_id).toBe(identity.userId)
})
test('existing email causes no write', () => {
  const f = fixture({ existing: true })
  expect(provision({ identity, transaction: makeTransaction(f.app, f.factory) })).toBeNull()
  expect(f.saved()).toHaveLength(0)
})
test('failure saving link aborts transaction', () => {
  const f = fixture({ failure: true })
  expect(() => provision({ identity, transaction: makeTransaction(f.app, f.factory) })).toThrow()
  expect(f.saved()).toHaveLength(0)
})
