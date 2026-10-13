migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      // We can call localhost or VITE_POCKETBASE_URL
      const pbUrl = 'http://127.0.0.1:8090'
      const resp = $http.send({
        url: `${pbUrl}/backend/v1/faturas/debug-probe`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_results = {
        statusCode: resp.statusCode,
        raw: resp.raw ? resp.raw.slice(0, 1000) : '',
      }
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (err) {
      try {
        const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
        const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
        existing.__probe_results = { err: err.message || String(err) }
        rec.set('dados_especificos', existing)
        app.save(rec)
      } catch (_) {}
    }
  },
  (app) => {},
)
