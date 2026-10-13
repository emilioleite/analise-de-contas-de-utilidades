migrate(
  (app) => {
    let errTrace = 'start'
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      errTrace += ' env_ok'

      // We will update the record 39dokv0aezvsvuz to write test results
      const redPixelPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

      let fastResult = ''
      let reasoningResult = ''
      let fastErr = ''
      let reasoningErr = ''

      // 1. $ai.chat fast with content array
      try {
        const res = $ai.chat({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'What color is this single pixel image? Answer ONLY color name.',
                },
                { type: 'image_url', image_url: { url: redPixelPng } },
              ],
            },
          ],
        })
        fastResult = res?.choices?.[0]?.message?.content || 'no content'
      } catch (e) {
        fastErr = e.message || String(e)
      }

      // 2. $ai.chat reasoning with content array
      try {
        const res = $ai.chat({
          model: 'reasoning',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'What color is this single pixel image? Answer ONLY color name.',
                },
                { type: 'image_url', image_url: { url: redPixelPng } },
              ],
            },
          ],
        })
        reasoningResult = res?.choices?.[0]?.message?.content || 'no content'
      } catch (e) {
        reasoningErr = e.message || String(e)
      }

      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__probe = {
        fastResult,
        fastErr,
        reasoningResult,
        reasoningErr,
        gwUrlPresent: !!gwUrl,
        gwKeyPresent: !!gwKey,
      }
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (err) {
      try {
        const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
        const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
        existing.__probe_err = err.message || String(err)
        rec.set('dados_especificos', existing)
        app.save(rec)
      } catch (_) {}
    }
  },
  (app) => {},
)
