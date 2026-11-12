migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      const probeRaw = existing.__probe_ai_results?.raw || ''
      const parsed = JSON.parse(probeRaw)
      existing.t1_text = parsed.test1_text_fast
      existing.t2_fast_nodetail = parsed.test2_fast_nodetail
      existing.t3_fast_detail = parsed.test3_fast_detail_high
      existing.t4_reas_nodetail = parsed.test4_reasoning_nodetail
      existing.t5_reas_detail = parsed.test5_reasoning_detail_high
      delete existing.__probe_ai_results
      delete existing.__probe_test
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (e) {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.__err = e.message
      rec.set('dados_especificos', existing)
      app.save(rec)
    }
  },
  (app) => {},
)
