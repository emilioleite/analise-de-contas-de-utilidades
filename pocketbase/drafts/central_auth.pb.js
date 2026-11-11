// DRAFT ONLY: outside the active hooks directory. Do not deploy as-is.
// Requires protected links migration, approved legacy mappings, runtime tests,
// and server-side enforcement of group revocation for existing PB tokens.
onRecordAuthWithPasswordRequest((event) => {
  const verify = require(__hooks + '/../lib/verify_central_credentials.js')
  const provision = require(__hooks + '/../lib/provision_central_user.js')
  const makeTransaction = require(__hooks + '/../lib/central_transaction.js')
  const lookup = require(__hooks + '/../lib/lookup_central_link.js')
  const flow = require(__hooks + '/../lib/central_password_flow.js')

  const record = flow({
    verify,
    provision,
    transaction: makeTransaction(event.app, (collection) => new Record(collection)),
    lookup: (uid) => lookup(event.app, uid),
    loadRecord: (id) => event.app.findRecordById('_pb_users_auth_', id),
    http: $http,
    url: $os.getenv('CENTRAL_SUPABASE_URL'),
    publishableKey: $os.getenv('CENTRAL_SUPABASE_PUBLISHABLE_KEY'),
    email: event.identity,
    password: event.password,
  })
  if (!record) throw new BadRequestError('Credenciais inválidas ou acesso não autorizado.')
  // Never call event.next(): that would invoke PocketBase local password auth.
  return $apis.recordAuthResponse(event, record, 'password')
}, 'users')
