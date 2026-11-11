const { expect, test } = require('bun:test')
const lookup = require('./lookup_central_link')
const uid = '11111111-1111-4111-8111-111111111111'
function appFor(options = {}) {
  return {
    findFirstRecordByFilter(collection, filter, params) {
      expect(collection).toBe('central_account_links')
      expect(filter).toBe('central_user_id = {:uid}')
      expect(params.uid).toBe(uid)
      if (options.missing) throw new Error('not found')
      return { getString(key) { return key === 'central_user_id' ? (options.uid || uid) : 'pb-user' } }
    },
    findRecordById(collection, id) {
      expect(collection).toBe('_pb_users_auth_')
      return { id, getString(key) { return key === 'email' ? 'u@example.com' : 'active' } }
    },
  }
}
test('returns an explicitly linked existing user', () => {
  expect(lookup(appFor(), uid)).toEqual({ id: 'pb-user', centralUserId: uid, email: 'u@example.com', status: 'active' })
})
test('denies absent or mismatched link and invalid identifier', () => {
  expect(lookup(appFor({ missing: true }), uid)).toBeNull()
  expect(lookup(appFor({ uid: 'other' }), uid)).toBeNull()
  expect(lookup(appFor(), 'invalid')).toBeNull()
})
