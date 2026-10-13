migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`

      // Public image URL on Skip CDN
      const cdnUrl = 'https://img.usecurling.com/p/200/200?q=cat'

      const respCdn = $http.send({
        url: cleanUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gwKey}` },
        body: JSON.stringify({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is this in 1 word?' },
                { type: 'image_url', image_url: { url: cdnUrl } },
              ],
            },
          ],
        }),
      })

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe_results = {
        cdn_status: respCdn.statusCode,
        cdn_raw: respCdn.raw ? respCdn.raw.slice(0, 300) : '',
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
