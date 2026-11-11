# Integração de login central — rascunho

Não implantar esta branch: a verificação central ainda não está conectada ao
login nem à autorização das requisições do PocketBase.

O aplicativo autentica pela coleção PocketBase `users`, preserva um token do
PocketBase e usa os IDs desses usuários e os papéis `admin` / `user` nas regras
e nos registros existentes. O fluxo de recuperação da sessão chama
`authRefresh` e, para alguns erros, mantém o token local.

Para ativação segura é necessário:

- Validar usuário e senha no Supabase e verificar o acesso efetivo do grupo à
  Análise de Contas, sem armazenar a senha.
- Preservar os IDs e relacionamentos dos registros PocketBase existentes. Não
  associar contas por e-mail sem uma verificação e plano de conflitos.
- Integrar a resposta de autenticação ao PocketBase sem manter um caminho de
  senha local alternativo que contorne a autorização central.
- Revisar tokens PocketBase já emitidos e verificar a revogação ou troca de
  grupo também nas requisições subsequentes, não apenas no login.
- Manter os papéis e escopos existentes, sem promover usuários a admin a partir
  de campos controlados pelo navegador.
- Validar em instância de teste PocketBase real, com contas e faturas de teste,
  antes de qualquer migração ou alteração no projeto do Skip.

O arquivo `pocketbase/lib/verify_central_credentials.js` é apenas um
verificador isolado. Seus testes usam respostas simuladas; isso não comprova o
runtime PocketBase, a preservação de faturas nem a segurança de sessões.
