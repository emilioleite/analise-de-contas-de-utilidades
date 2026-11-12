migrate(
  (app) => {
    try {
      const pbUrl = $os.getenv('PB_INSTANCE_URL') || $os.getenv('SITE_URL')
      const resp = $http.send({
        url: `${pbUrl.replace(/\/+$/, '')}/backend/v1/test/probe-ai`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_ai_results = {
        pbUrl,
        statusCode: resp.statusCode,
        raw: resp.raw || '',
      }
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (err) {
      try {
        const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
        const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
        existing.__probe_ai_results = { err: err.message || String(err) }
        rec.set('dados_especificos', existing)
        app.save(rec)
      } catch (_) {}
    }
  },
  (app) => {}
)
