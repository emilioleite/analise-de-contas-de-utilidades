// DESATIVADO (correção de segurança urgente, 2026-11-11):
// esta rota de exportação foi SUSPENSA e retorna SEMPRE HTTP 503 sem nenhum dado.
//
// Motivo: a versão anterior deste hook (v0.0.88/0.0.89, janela de migração
// PocketBase → Supabase) aceitava uma chave de acesso embutida no código e um
// token de superusuário validado SEM verificação de assinatura — a rota expunha
// toda a base (usuários, faturas, dados de medição). Sob solicitação do
// responsável, a rota foi desativada em todas as formas de autenticação
// anteriormente aceitas (chave via ?senha=, Bearer de superusuário, role=admin)
// e a chave embutida foi REMOVIDA deste arquivo. Nenhuma chave de exportação
// existe mais no código-fonte, na configuração ou nos segredos do backend.
//
// A rota permanece registrada apenas para responder 503 explícito (sem corpo de
// dados) e não deve ser reativada sem nova decisão do responsável.
routerAdd('GET', '/backend/v1/admin/export-full', (e) => {
  console.warn('[admin-export-full] ROTA DESATIVADA — chamada recusada com 503.')
  return e.json(503, {
    sucesso: false,
    erro: 'Serviço indisponível: rota de exportação desativada por segurança.',
  })
})
// CHANGELOG (desativação): toda a lógica de exportação (leitura de users,
// empreendimentos, faturas, fatores_emissao e _superusers, incl. passwordHash)
// foi removida, junto com a chave embutida e a validação não-verificada de
// token de superusuário. Nenhuma leitura de dados acontece nesta rota.
