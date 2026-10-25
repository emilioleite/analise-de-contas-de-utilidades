migrate(
  (app) => {
    // Migration idempotente: caso a fatura Comgás 02/2026 (NF 140.162.786) esteja com valor_total = 0, atualiza para 211.20
    const records = app.findRecordsByFilter(
      'faturas',
      "numero_fatura ~ '140.162.786' || numero_fatura ~ '140162786'",
      '-created',
      50,
    )

    for (const record of records) {
      const comp = record.getString('competencia') || ''
      const val = record.getFloat('valor_total')

      // Verificar se é competência de fevereiro de 2026 e se o valor_total atual é 0
      if ((comp.startsWith('2026-02') || comp.includes('2026-02')) && (!val || val === 0)) {
        record.set('valor_total', 211.2)
        app.save(record)
      }
    }
  },
  (app) => {
    // rollback no-op (idempotente)
  },
)
