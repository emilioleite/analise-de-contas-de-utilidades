migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')

      // We will save results into a temporary faturas or read it
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

      // Save test diagnostics into an existing record's dados_especificos or a new test record
      const emp = app.findFirstRecordByData('empreendimentos', 'cnpj', '04.151.776/0001-63')
      const col = app.findCollectionByNameOrId('faturas')
      const testRec = new Record(col)
      testRec.set('empreendimento', emp.id)
      testRec.set('tipo_utilidade', 'Energia Elétrica')
      testRec.set('competencia', '2099-01-01')
      testRec.set('valor_total', 1.0)
      testRec.set('consumo', 1.0)
      testRec.set('unidade_consumo', 'kWh')
      testRec.set('numero_fatura', 'TEST_VISION_PROBE')
      testRec.set('dados_especificos', {
        fastResult,
        fastErr,
        reasoningResult,
        reasoningErr,
        gwUrlPresent: !!gwUrl,
        gwKeyPresent: !!gwKey,
      })
      app.save(testRec)
    } catch (err) {
      // ignore
    }
  },
  (app) => {},
)
