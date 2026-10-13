migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    const empreendimentosCol = app.findCollectionByNameOrId('empreendimentos')
    const faturasCol = app.findCollectionByNameOrId('faturas')

    // 1. Seed or find user andino@aquecetecnica.com.br
    let userRecord
    try {
      userRecord = app.findAuthRecordByEmail('_pb_users_auth_', 'andino@aquecetecnica.com.br')
    } catch (_) {
      userRecord = new Record(users)
      userRecord.setEmail('andino@aquecetecnica.com.br')
      userRecord.setPassword('Skip@Pass')
      userRecord.setVerified(true)
      userRecord.set('name', 'Andino Aquecetecnica')
      app.save(userRecord)
    }

    const userId = userRecord.id

    // 2. Seed 3 Empreendimentos (idempotent)
    const empresasData = [
      {
        nome: 'Sede Administrativa',
        cnpj: '12.345.678/0001-90',
        endereco: 'Av. Paulista, 1000, Bela Vista, São Paulo - SP',
        tipo: 'Comercial',
      },
      {
        nome: 'Unidade Industrial',
        cnpj: '98.765.432/0001-10',
        endereco: 'Rod. dos Bandeirantes, km 72, Itupeva - SP',
        tipo: 'Industrial',
      },
      {
        nome: 'Filial Centro',
        cnpj: '11.222.333/0001-44',
        endereco: 'Rua Direita, 250, Centro Histórico, São Paulo - SP',
        tipo: 'Comercial',
      },
    ]

    const empresaRecords = []
    for (let i = 0; i < empresasData.length; i++) {
      const item = empresasData[i]
      let empRecord
      try {
        empRecord = app.findFirstRecordByData('empreendimentos', 'cnpj', item.cnpj)
      } catch (_) {
        empRecord = new Record(empreendimentosCol)
        empRecord.set('nome', item.nome)
        empRecord.set('cnpj', item.cnpj)
        empRecord.set('endereco', item.endereco)
        empRecord.set('tipo', item.tipo)
        empRecord.set('owner', userId)
        app.save(empRecord)
      }
      empresaRecords.push(empRecord)
    }

    // 3. Seed Invoices for the last 24 months (idempotent)
    // Check if faturas are already seeded
    const existingFaturasCount = app.countRecords('faturas')
    if (existingFaturasCount > 10) {
      return // Already populated
    }

    // Generate 24 monthly competencies (e.g., from 2023-04-01 to 2025-03-01)
    const months = []
    const now = new Date()
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      months.push(`${yyyy}-${mm}-01 00:00:00.000Z`)
    }

    const utilidades = [
      {
        tipo: 'Energia Elétrica',
        unidade: 'kWh',
        baseConsumo: 4200,
        baseValor: 3850,
        variacaoConsumo: 800,
        variacaoValor: 750,
        prefixNF: 'ENERG-',
      },
      {
        tipo: 'Água e Esgoto',
        unidade: 'm³',
        baseConsumo: 180,
        baseValor: 1450,
        variacaoConsumo: 40,
        variacaoValor: 320,
        prefixNF: 'SABESP-',
      },
      {
        tipo: 'Gás',
        unidade: 'm³',
        baseConsumo: 320,
        baseValor: 2100,
        variacaoConsumo: 60,
        variacaoValor: 410,
        prefixNF: 'COMGAS-',
      },
    ]

    // Distribute across the 3 enterprises over the 24 months
    for (let m = 0; m < months.length; m++) {
      const compDate = months[m]
      // Each month will have realistic bills for at least 2 or 3 enterprises
      for (let u = 0; u < utilidades.length; u++) {
        const util = utilidades[u]
        // Select enterprise round-robin
        const empIndex = (m + u) % empresaRecords.length
        const emp = empresaRecords[empIndex]
        const cnpj = emp.getString('cnpj')

        // Seed varied realistic data
        const monthNum = m + 1
        const seasonalFactor = 1 + 0.18 * Math.sin((monthNum * Math.PI) / 6)
        const consumo = Math.round(
          (util.baseConsumo + ((m * 17) % util.variacaoConsumo)) * seasonalFactor,
        )
        const valor =
          Math.round((util.baseValor + ((m * 29) % util.variacaoValor)) * seasonalFactor * 100) /
          100
        const nfNum = `${util.prefixNF}2024-${String(m * 3 + u + 1001).padStart(5, '0')}`

        let dadosEsp = {}
        if (util.tipo === 'Energia Elétrica') {
          const medAnt = 100000 + m * 4200
          const medAtu = medAnt + consumo
          const ponta = Math.round(consumo * 0.28)
          const fPonta = consumo - ponta
          dadosEsp = {
            medicao_anterior: medAnt,
            medicao_atual: medAtu,
            classificacao_consumo: 'A4',
            consumo_ponta: ponta,
            tarifa_tusd_ponta: 0.62,
            tarifa_te_ponta: 0.41,
            consumo_fora_ponta: fPonta,
            tarifa_tusd_f_ponta: 0.24,
            tarifa_te_f_ponta: 0.32,
            adicional_bandeira:
              m % 4 === 0
                ? 'Bandeira Vermelha'
                : m % 3 === 0
                  ? 'Bandeira Amarela'
                  : 'Bandeira Verde',
            fatura_total: valor,
          }
        } else if (util.tipo === 'Gás') {
          const medAnt = 20000 + m * 320
          const medAtu = medAnt + consumo
          dadosEsp = {
            medicao_anterior: medAnt,
            medicao_atual: medAtu,
            consumo_medido: consumo,
            consumo_corrigido: Math.round(consumo * 1.04 * 100) / 100,
            tarifa: 6.56,
            fatura_total: valor,
          }
        } else {
          const medAnt = 5000 + m * 180
          const medAtu = medAnt + consumo
          dadosEsp = {
            medicao_anterior: medAnt,
            medicao_atual: medAtu,
            consumo_medido: consumo,
            tarifa: 8.05,
            fatura_total: valor,
          }
        }

        const fatura = new Record(faturasCol)
        fatura.set('empreendimento', emp.id)
        fatura.set('tipo_utilidade', util.tipo)
        fatura.set('competencia', compDate)
        fatura.set('valor_total', valor)
        fatura.set('consumo', consumo)
        fatura.set('unidade_consumo', util.unidade)
        fatura.set('numero_fatura', nfNum)
        fatura.set('cnpj_fornecedor', cnpj)
        fatura.set('cnpj_validado', true)
        fatura.set('arquivo_nome', null)
        fatura.set('dados_especificos', JSON.stringify(dadosEsp))
        fatura.set('owner', userId)
        app.save(fatura)
      }
    }
  },
  (app) => {
    // down migration
    try {
      const faturasCol = app.findCollectionByNameOrId('faturas')
      app.truncateCollection(faturasCol)
    } catch (_) {}
  },
)
