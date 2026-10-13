migrate(
  (app) => {
    try {
      const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
      const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
      console.log('[probe-v17] Testing $ai.chat vs $http.send direct...')

      // 1x1 transparent red pixel base64
      const samplePng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

      // Test 1: $ai.chat with standard content array
      try {
        const resAi = $ai.chat({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What color is this single pixel image? Answer in 1 word.' },
                { type: 'image_url', image_url: { url: samplePng } },
              ],
            },
          ],
        })
        console.log('[probe-v17] $ai.chat result:', JSON.stringify(resAi.choices[0].message))
      } catch (e) {
        console.log('[probe-v17] $ai.chat error:', e.message || e)
      }

      // Test 2: $ai.chat with reasoning model
      try {
        const resAiR = $ai.chat({
          model: 'reasoning',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What color is this single pixel image? Answer in 1 word.' },
                { type: 'image_url', image_url: { url: samplePng } },
              ],
            },
          ],
        })
        console.log(
          '[probe-v17] $ai.chat reasoning result:',
          JSON.stringify(resAiR.choices[0].message),
        )
      } catch (e) {
        console.log('[probe-v17] $ai.chat reasoning error:', e.message || e)
      }
    } catch (err) {
      console.log('[probe-v17] Global error:', err.message || err)
    }
  },
  (app) => {},
)
