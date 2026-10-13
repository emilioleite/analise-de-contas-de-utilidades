migrate(
  (app) => {
    // Dispara a rota manual interna para validar a execução
    try {
      const resp = $http.send({
        url: 'https://analise-de-contas-de-utilidades-fd0c4.shrd00.internal.goskip.dev/atualiza-fatores-sin',
        method: 'POST',
        timeout: 30,
      })
      console.log('[0045_test_trigger_atualiza_fatores] Status:', resp.statusCode)
      console.log(
        '[0045_test_trigger_atualiza_fatores] Resposta:',
        resp.raw ? resp.raw.slice(0, 500) : '',
      )
    } catch (e) {
      console.log('[0045_test_trigger_atualiza_fatores] Erro ao disparar:', e.message || e)
    }
  },
  () => {},
)
