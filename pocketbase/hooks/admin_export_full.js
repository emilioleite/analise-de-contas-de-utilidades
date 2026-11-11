// Exportação temporariamente suspensa até existir autenticação de administrador
// validada pelo servidor e uma estratégia de migração revisada.
routerAdd('GET', '/backend/v1/admin/export-full', (event) => {
  return event.json(503, { sucesso: false, erro: 'Exportação temporariamente indisponível.' })
})
