const { expect, test } = require('bun:test')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
test('draft creates protected one-to-one links without touching users', () => {
  let up
  const saved = []
  class Collection { constructor(config) { Object.assign(this, config) } }
  vm.runInNewContext(readFileSync(__dirname + '/central_account_links.js', 'utf8'), {
    Collection,
    migrate(fn) { up = fn },
  })
  up({ findCollectionByNameOrId() { return { id: 'users-collection' } }, save(collection) { saved.push(collection) } })
  expect(saved).toHaveLength(1)
  expect(saved[0].name).toBe('central_account_links')
  for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) expect(saved[0][rule]).toBeNull()
  expect(saved[0].fields.find((field) => field.name === 'pocketbase_user').collectionId).toBe('users-collection')
  expect(saved[0].indexes).toHaveLength(2)
})
