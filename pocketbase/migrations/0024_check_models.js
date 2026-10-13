migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`

      const base64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const dataUri = `data:image/png;base64,${base64Data}`

      // Let's test standard image_url with http URL vs data URL
      // Maybe data:image/png;base64 needs detail: "auto" or no detail, or url without space?
      const respUrlNoDetail = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gwKey}` },
        body: JSON.stringify({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Color:' },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ],
        }),
      })

      // Also check what GET /models or similar returns
      const respModels = $http.send({
        url: `${gwUrl.replace(/\/+$/, '')}/models`,
        method: 'GET',
        headers: { Authorization: `Bearer ${gwKey}` },
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_results = {
        models_status: respModels.statusCode,
        models_raw: respModels.raw ? respModels.raw.slice(0, 500) : '',
        noDetail_status: respUrlNoDetail.statusCode,
        noDetail_raw: respUrlNoDetail.raw ? respUrlNoDetail.raw.slice(0, 500) : '',
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
