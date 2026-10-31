migrate(
  (app) => {
    // Migration 0052 test probe (idempotente)
    // Limpeza defensiva de qualquer registro de teste residual com numero_fatura = 'TEST-VALOR-ZERO-CHECK'
    try {
      const records = app.findRecordsByFilter(
        'faturas',
        "numero_fatura = 'TEST-VALOR-ZERO-CHECK'",
        '-created',
        10,
      )
      for (const r of records) {
        app.delete(r)
      }
    } catch (_) {}
  },
  (app) => {
    // no-op
  },
)
