const { test, expect } = require('bun:test')
const authenticate = require('./authenticate_linked_account')
function run(overrides = {}) {
  return authenticate({
    verify: () => ({ userId: 'central', email: 'user@example.com' }),
    lookupLinkedRecord: () => ({ id: 'existing-pb', centralUserId: 'central', email: 'user@example.com', status: 'active', role: 'user' }),
    ...overrides,
  })
}
test('returns existing PocketBase identifier for a confirmed linked account', () => {
  expect(run()).toEqual({ recordId: 'existing-pb', centralUserId: 'central' })
})
test('does not accept missing central authorization or missing link', () => {
  expect(run({ verify: () => null })).toBeNull()
  expect(run({ lookupLinkedRecord: () => null })).toBeNull()
})
test('does not identify a record by email alone', () => {
  expect(run({ lookupLinkedRecord: () => ({ id: 'existing-pb', centralUserId: 'different', email: 'user@example.com', status: 'active' }) })).toBeNull()
})
test('denies inactive account or changed email', () => {
  expect(run({ lookupLinkedRecord: () => ({ id: 'existing-pb', centralUserId: 'central', email: 'user@example.com', status: 'inactive' }) })).toBeNull()
  expect(run({ lookupLinkedRecord: () => ({ id: 'existing-pb', centralUserId: 'central', email: 'other@example.com', status: 'active' }) })).toBeNull()
})
