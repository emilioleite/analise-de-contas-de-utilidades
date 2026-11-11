// Draft PocketBase transaction adapter; not registered as a hook.
// All external authentication must finish before opening this transaction.
module.exports = function makeCentralTransaction(app, makeRecord) {
  return function transaction(callback) {
    let outcome
    app.runInTransaction((txApp) => {
      const tx = {
        findLink(uid) {
          const rows = txApp.findRecordsByFilter('central_account_links',
            'central_user_id = {:uid}', '', 2, 0, { uid })
          if (rows.length > 1) throw new Error('Ambiguous central identity link')
          return rows.length ? { recordId: rows[0].getString('pocketbase_user') } : null
        },
        findUserByEmail(email) {
          const rows = txApp.findRecordsByFilter('_pb_users_auth_',
            'email = {:email}', '', 1, 0, { email })
          return rows.length ? rows[0] : null
        },
        createUser(data) {
          const user = makeRecord(txApp.findCollectionByNameOrId('_pb_users_auth_'))
          user.set('email', data.email)
          user.set('role', data.role)
          user.set('status', data.status)
          user.setRandomPassword()
          txApp.save(user)
          return { id: user.id }
        },
        createLink(data) {
          const link = makeRecord(txApp.findCollectionByNameOrId('central_account_links'))
          link.set('central_user_id', data.centralUserId)
          link.set('pocketbase_user', data.recordId)
          txApp.save(link)
        },
      }
      outcome = callback(tx)
    })
    return outcome
  }
}
