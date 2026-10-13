migrate(
  (app) => {
    // 1. Criar coleção fatores_emissao
    const collection = new Collection({
      name: 'fatores_emissao',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'chave',
          type: 'text',
          required: true,
        },
        {
          name: 'tipo',
          type: 'select',
          values: [
            'energia_mensal',
            'energia_fallback',
            'gas_natural',
            'agua_abastecimento',
            'agua_esgoto',
          ],
          maxSelect: 1,
          required: true,
        },
        {
          name: 'ano',
          type: 'number',
          onlyInt: true,
        },
        {
          name: 'mes',
          type: 'number',
          onlyInt: true,
        },
        {
          name: 'valor',
          type: 'number',
          required: true,
        },
        {
          name: 'unidade',
          type: 'text',
          required: true,
        },
        {
          name: 'is_oficial',
          type: 'bool',
        },
        {
          name: 'fonte',
          type: 'text',
        },
        {
          name: 'descricao',
          type: 'text',
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_fatores_chave ON fatores_emissao (chave)',
        'CREATE INDEX idx_fatores_tipo ON fatores_emissao (tipo)',
      ],
    })
    app.save(collection)

    // 2. Semear registros iniciais
    // Fatores SIN conhecidos (kg CO2/MWh -> tCO2/MWh: dividir por 1000)
    // 2024: jan 41,6 kg/MWh = 0.0416; fev 37,5 = 0.0375; mar 27,8 = 0.0278; abr 19,4 = 0.0194
    // 2025: jan 23,7 = 0.0237; fev 24,8 = 0.0248; mar 21,5 = 0.0215; abr 28,9 = 0.0289
    // Fallback anual energia: 0.0500 tCO2/MWh
    // Gas natural: 2.15 kgCO2e/m3
    // Agua abastecimento: 0.208 kgCO2e/m3; tratamento: 0.700 kgCO2e/m3 (total 0.908)

    const seeds = [
      // Fatores globais / gerais
      {
        chave: 'energia_fallback',
        tipo: 'energia_fallback',
        valor: 0.05,
        unidade: 'tCO₂/MWh',
        is_oficial: false,
        fonte: 'Estimativa provisória configurável (fallback)',
        descricao:
          'Fator médio provisório aplicado para meses sem publicação oficial do MCTI/SIRENE',
      },
      {
        chave: 'gas_natural',
        tipo: 'gas_natural',
        valor: 2.15,
        unidade: 'kgCO₂e/m³',
        is_oficial: true,
        fonte: 'IPCC 2006 / Programa Brasileiro GHG Protocol',
        descricao: 'Combustão estacionária (Escopo 1) — PCI 38,3 MJ/m³ × FEOC 15,3 tC/TJ',
      },
      {
        chave: 'agua_abastecimento',
        tipo: 'agua_abastecimento',
        valor: 0.208,
        unidade: 'kgCO₂e/m³',
        is_oficial: false,
        fonte: 'Prática do Programa Brasileiro GHG Protocol (estimativa setorial)',
        descricao: 'Emissões indiretas de captação e distribuição de água tratada (Escopo 3)',
      },
      {
        chave: 'agua_esgoto',
        tipo: 'agua_esgoto',
        valor: 0.7,
        unidade: 'kgCO₂e/m³',
        is_oficial: false,
        fonte: 'Prática do Programa Brasileiro GHG Protocol (estimativa setorial)',
        descricao: 'Emissões indiretas de coleta e tratamento de efluentes sanitários (Escopo 3)',
      },

      // Fatores Mensais Oficiais MCTI - 2024
      {
        chave: 'sin_2024_01',
        tipo: 'energia_mensal',
        ano: 2024,
        mes: 1,
        valor: 0.0416,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (41,6 kgCO₂/MWh)',
        descricao: 'Janeiro/2024 — Publicação oficial MCTI',
      },
      {
        chave: 'sin_2024_02',
        tipo: 'energia_mensal',
        ano: 2024,
        mes: 2,
        valor: 0.0375,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (37,5 kgCO₂/MWh)',
        descricao: 'Fevereiro/2024 — Publicação oficial MCTI',
      },
      {
        chave: 'sin_2024_03',
        tipo: 'energia_mensal',
        ano: 2024,
        mes: 3,
        valor: 0.0278,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (27,8 kgCO₂/MWh)',
        descricao: 'Março/2024 — Publicação oficial MCTI',
      },
      {
        chave: 'sin_2024_04',
        tipo: 'energia_mensal',
        ano: 2024,
        mes: 4,
        valor: 0.0194,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (19,4 kgCO₂/MWh)',
        descricao: 'Abril/2024 — Publicação oficial MCTI',
      },

      // Fatores Mensais Oficiais MCTI - 2025
      {
        chave: 'sin_2025_01',
        tipo: 'energia_mensal',
        ano: 2025,
        mes: 1,
        valor: 0.0237,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (23,7 kgCO₂/MWh)',
        descricao: 'Janeiro/2025 — Publicação oficial MCTI',
      },
      {
        chave: 'sin_2025_02',
        tipo: 'energia_mensal',
        ano: 2025,
        mes: 2,
        valor: 0.0248,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (24,8 kgCO₂/MWh)',
        descricao: 'Fevereiro/2025 — Publicação oficial MCTI',
      },
      {
        chave: 'sin_2025_03',
        tipo: 'energia_mensal',
        ano: 2025,
        mes: 3,
        valor: 0.0215,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (21,5 kgCO₂/MWh)',
        descricao: 'Março/2025 — Publicação oficial MCTI',
      },
      {
        chave: 'sin_2025_04',
        tipo: 'energia_mensal',
        ano: 2025,
        mes: 4,
        valor: 0.0289,
        unidade: 'tCO₂/MWh',
        is_oficial: true,
        fonte: 'Fator médio do SIN — MCTI/SIRENE (28,9 kgCO₂/MWh)',
        descricao: 'Abril/2025 — Publicação oficial MCTI',
      },
    ]

    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i]
      const rec = new Record(collection)
      rec.set('chave', s.chave)
      rec.set('tipo', s.tipo)
      if (s.ano !== undefined) rec.set('ano', s.ano)
      if (s.mes !== undefined) rec.set('mes', s.mes)
      rec.set('valor', s.valor)
      rec.set('unidade', s.unidade)
      rec.set('is_oficial', s.is_oficial ? true : false)
      if (s.fonte) rec.set('fonte', s.fonte)
      if (s.descricao) rec.set('descricao', s.descricao)
      app.save(rec)
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('fatores_emissao')
      app.delete(collection)
    } catch (_) {}
  },
)
