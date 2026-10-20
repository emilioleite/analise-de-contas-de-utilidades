migrate(
  (app) => {
    // Backfill seguro e idempotente: limpar valores de CNPJ claramente truncados nas faturas existentes
    const records = app.findRecordsByFilter(
      'faturas',
      "cnpj_cliente != '' || cnpj_fornecedor != ''",
      '-created',
      1000,
    )
    for (const record of records) {
      let changed = false
      const rawCli = record.get('cnpj_cliente') || ''
      if (rawCli) {
        const cleanCli = String(rawCli).replace(/\D/g, '')
        // Se tiver menos de 14 dígitos e não for o padrão mascarado Enel, limpar
        if (cleanCli.length < 14) {
          record.set('cnpj_cliente', '')
          changed = true
        }
      }

      const rawForn = record.get('cnpj_fornecedor') || ''
      if (rawForn) {
        const cleanForn = String(rawForn).replace(/\D/g, '')
        if (cleanForn.length < 14) {
          record.set('cnpj_fornecedor', '')
          changed = true
        }
      }

      if (changed) {
        app.save(record)
      }
    }
  },
  (app) => {
    // rollback no-op
  },
)
