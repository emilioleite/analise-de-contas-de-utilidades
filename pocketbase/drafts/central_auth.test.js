const { expect, test } = require('bun:test')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
function setup(result) {
  let hook, nextCalled = false
  const modules = {
    'verify_central_credentials.js': () => null,
    'provision_central_user.js': () => null,
    'central_transaction.js': () => () => null,
    'lookup_central_link.js': () => null,
    'central_password_flow.js': () => result,
  }
  class BadRequestError extends Error {}
  vm.runInNewContext(readFileSync(__dirname + '/central_auth.pb.js', 'utf8'), {
    onRecordAuthWithPasswordRequest(fn, name) { expect(name).toBe('users'); hook = fn },
    require(path) { return modules[path.split('/').pop()] },
    __hooks: '/hooks', $http: {}, $os: { getenv() { return 'configured' } },
    $apis: { recordAuthResponse(_event, record, method) { return { record, method } } },
    BadRequestError, Record: class {},
  })
  const event = { app: {}, identity: 'u@example.com', password: 'secret', next() { nextCalled = true } }
  return { hook, event, nextCalled: () => nextCalled }
}
test('returns PocketBase auth response for verified record', () => {
  const context = setup({ id: 'existing' })
  expect(context.hook(context.event)).toEqual({ record: { id: 'existing' }, method: 'password' })
  expect(context.nextCalled()).toBe(false)
})
test('denies without falling back to local password', () => {
  const context = setup(null)
  expect(() => context.hook(context.event)).toThrow()
  expect(context.nextCalled()).toBe(false)
})
