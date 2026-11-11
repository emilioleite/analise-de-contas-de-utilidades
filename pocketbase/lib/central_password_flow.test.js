const { test, expect } = require('bun:test')
const flow = require('./central_password_flow')
function run(overrides = {}) {
  let created = 0
  const record = { id: 'pb-1' }
  const result = flow({
    verify: () => ({ userId: 'central', email: 'user@example.com' }),
    provision: () => { created++; return { recordId: 'pb-1' } },
    lookup: () => ({ id: 'pb-1', centralUserId: 'central', email: 'user@example.com', status: 'active' }),
    loadRecord: () => record,
    ...overrides,
  })
  return { result, created }
}
test('returns linked PocketBase record after central authorization', () => {
  expect(run().result).toEqual({ id: 'pb-1' })
})
test('invalid central credentials do not provision a user', () => {
  const result = run({ verify: () => null })
  expect(result.result).toBeNull()
  expect(result.created).toBe(0)
})
test('email conflicts and bad links fail closed', () => {
  expect(run({ provision: () => null }).result).toBeNull()
  expect(run({ lookup: () => null }).result).toBeNull()
  expect(run({ lookup: () => ({ id: 'other', centralUserId: 'central', email: 'user@example.com', status: 'active' }) }).result).toBeNull()
})
test('inactive or email-mismatched PocketBase records fail closed', () => {
  expect(run({ lookup: () => ({ id: 'pb-1', centralUserId: 'central', email: 'user@example.com', status: 'inactive' }) }).result).toBeNull()
  expect(run({ lookup: () => ({ id: 'pb-1', centralUserId: 'central', email: 'other@example.com', status: 'active' }) }).result).toBeNull()
})
