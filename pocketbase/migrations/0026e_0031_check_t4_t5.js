migrate(
  (app) => {
    try {
      const rec = app.findRecordById('faturas', '39dokv0aezvsvuz')
      const existing = JSON.parse(rec.getString('dados_especificos') || '{}')
      existing.t3_err = existing.t3_fast_detail ? existing.t3_fast_detail.err || 'ok' : 'missing'
      existing.t4_err = existing.t4_reas_nodetail ? existing.t4_reas_nodetail.err || 'ok' : 'missing'
      existing.t4_ok = existing.t4_reas_nodetail?.ok
      existing.t4_reply = existing.t4_reas_nodetail?.reply
      existing.t5_err = existing.t5_reas_detail ? existing.t5_reas_detail.err || 'ok' : 'missing'
      existing.t5_ok = existing.t5_reas_detail?.ok
      existing.t5_reply = existing.t5_reas_detail?.reply
      delete existing.t1_text
      delete existing.t2_fast_nodetail
      delete existing.t3_fast_detail
      delete existing.t4_reas_nodetail
      delete existing.t5_reas_detail
      rec.set('dados_especificos', existing)
      app.save(rec)
    } catch (_) {}
  },
  (app) => {}
)
