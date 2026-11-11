// DRAFT ONLY: kept outside migrations so PocketBase will not apply it.
// Requires review and isolated PocketBase validation before being adopted.
// Does not create any links or alter existing users and invoices.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    const links = new Collection({
      type: 'base',
      name: 'central_account_links',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'central_user_id', type: 'text', required: true, min: 36, max: 36,
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
        { name: 'pocketbase_user', type: 'relation', required: true, maxSelect: 1,
          collectionId: users.id, cascadeDelete: false },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_central_account_links_uid ON central_account_links (central_user_id)',
        'CREATE UNIQUE INDEX idx_central_account_links_pb_user ON central_account_links (pocketbase_user)',
      ],
    })
    app.save(links)
  },
  () => {
    // Intentionally no automatic deletion of identity links on rollback.
    throw new Error('Identity link rollback requires an explicit migration plan.')
  },
)
