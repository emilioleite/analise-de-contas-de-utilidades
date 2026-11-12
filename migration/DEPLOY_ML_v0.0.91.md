# Deploy do hook fatura_extract — correções Mercado Livre (v0.0.91)

Data: 2026-11-12 · Versão do projeto: 0.0.91

## Contexto

A v0.0.91 commitou correções no hook `pocketbase/hooks/fatura_extract.js` para
faturas de energia do Mercado Livre (ACL), mas o backend não havia sido
reimplantado. Esta rodada apenas reimplantou o backend (deploy idempotente),
sem alterar código, coleções ou dados.

## Correções confirmadas no hook (arquivo em repositório)

- Classificação Mercado Livre: NUNCA B1–B4; consumo ≥ 10.000 kWh/mês →
  classificacao_consumo = "A" (subclasse A1–A4 só se impressa na fatura).
  (fatura_extract.js, linhas ~243, 489, 1683–1718)
- Tarifa: preço unitário da NFe em R$/MWh → Tarifa TE em R$/kWh (÷1000,
  ex.: 186,53 → 0,18653) em tarifa_te_ponta; TUSD (tarifa_tusd_ponta) fica
  vazia/null. (fatura_extract.js, linhas ~244–245, 1737–1743)
- Logs de auditoria no hook: "[fatura_extract] Mercado Livre: descartando
  classificação Grupo B/imprecisa", "... indica GRUPO A." etc.

## Ações executadas

1. Conferência do hook no repositório (grep das regras de Mercado Livre) — OK.
2. `deploy_backend` — deploy das funções (pb_hooks) concluído com sucesso.
3. `list_logs` (stream hooks) — hook `fatura_extract` executando ao vivo
   (extrações de Gás em 2026-11-12 23:33–23:34), sem erros após o deploy.
4. Migrações: 0068 é a última aplicada; nenhuma migração nova necessária.
5. QA (lint, typecheck, build) — nenhum arquivo foi alterado nesta rodada;
   o pipeline de QA do projeto não executa sem mudanças pendentes no
   working tree. A v0.0.91 (código idêntico ao deployado) passou por QA e
   foi commitada na rodada anterior.

## Restrições respeitadas

- Sem migração de dados, sem alterações de coleções/dados.
- Rota /backend/v1/admin/export-full permanece desativada (503 incondicional) —
  o hook admin_export_full segue no ar nessa condição.
- Fluxo de login intocado.
