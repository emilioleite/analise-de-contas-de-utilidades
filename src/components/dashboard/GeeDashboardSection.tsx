import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Leaf, Flame, Zap, Droplets, ArrowUpRight, Info } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatTCO2e } from '@/lib/cnpj'
import { construirSerieEmissoes } from '@/lib/emissoesPeriodo'
import { FaixaFontes } from '@/components/emissoes/FaixaFontes'
import { CalculoEmissaoFatura } from '@/types/entities'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts'

/**
 * Bloco de emissões de GEE no Dashboard.
 *
 * Usa a MESMA janela de competências do dashboard (não uma janela fixa de 24 meses):
 * o período é o que está sendo exibido. Mês sem fatura é lacuna, não zero; a média
 * divide pelos meses com fatura. O total misto (oficial + estimativa setorial) é
 * sinalizado pela FaixaFontes — número consolidado não é inventário verificado.
 */
export function GeeDashboardSection({
  calculos,
  meses,
  empreendimentos,
  nomeEmpreendimento,
  periodoTexto,
  mostrarPorEmpreendimento,
}: {
  calculos: CalculoEmissaoFatura[]
  meses: string[]
  empreendimentos: Array<{ id: string; nome?: string }>
  nomeEmpreendimento: string
  periodoTexto: string
  mostrarPorEmpreendimento: boolean
}) {
  const resumo = useMemo(
    () => construirSerieEmissoes({ calculos, meses, empreendimentos }),
    [calculos, meses, empreendimentos],
  )

  const esc1 = resumo.porEscopo['Escopo 1']
  const esc2 = resumo.porEscopo['Escopo 2']
  const esc3 = resumo.porEscopo['Escopo 3']
  const total = resumo.totalPeriodo

  const cards = [
    {
      titulo: 'Total do Período',
      dados: null as null | typeof esc1,
      valor: total,
      cor: '#0F766E',
      icon: Leaf,
      bg: 'bg-teal-50 text-teal-700',
      sub:
        resumo.mediaMensal === null
          ? 'Sem mês com fatura — média ND'
          : `Média ${formatTCO2e(resumo.mediaMensal, 2)}/mês com fatura (${resumo.mesesComDado} de ${resumo.qtdMeses})`,
    },
    {
      titulo: 'Escopo 1 (Gás)',
      dados: esc1,
      valor: esc1.total,
      cor: '#14B8A6',
      icon: Flame,
      bg: 'bg-teal-50 text-teal-600',
      sub: 'Combustão estacionária — IPCC 2006',
    },
    {
      titulo: 'Escopo 2 (Energia)',
      dados: esc2,
      valor: esc2.total,
      cor: '#F59E0B',
      icon: Zap,
      bg: 'bg-amber-50 text-amber-600',
      sub: 'Fator mensal do SIN — MCTI/SIRENE',
    },
    {
      titulo: 'Escopo 3 (Água/Esgoto)',
      dados: esc3,
      valor: esc3.total,
      cor: '#0EA5E9',
      icon: Droplets,
      bg: 'bg-sky-50 text-sky-600',
      sub: 'Estimativa setorial — PB GHG Protocol',
    },
  ]

  return (
    <div className="space-y-4 pt-2">
      <div className="border-b border-gray-200 pb-2 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-gray-900 tracking-tight">
            Emissões de GEE no Período
          </h3>
          <p className="text-xs text-gray-500">
            {nomeEmpreendimento} • {periodoTexto} — tCO₂e apurado das faturas do mesmo período
            acima.
          </p>
        </div>
        <Link
          to="/emissoes"
          className="text-xs text-teal-700 hover:underline font-semibold flex items-center shrink-0"
        >
          Abrir módulo de Emissões
          <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
        </Link>
      </div>

      {!resumo.temDados ? (
        <Card className="p-6 border-[#E5E7EB] shadow-sm">
          <p className="text-xs text-gray-500">
            Nenhuma emissão apurada no período: não há fatura lançada para a seleção. Não há como
            estimar sem consumo.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((c) => {
              const Icon = c.icon
              const pct = total > 0 ? (c.valor / total) * 100 : null
              return (
                <Card
                  key={c.titulo}
                  className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all"
                  style={{ borderLeft: `5px solid ${c.cor}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {c.titulo}
                    </span>
                    <div className={`p-2 rounded-xl ${c.bg}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold text-gray-900 tracking-tight tabular-nums font-mono">
                      {formatTCO2e(c.valor, 2)}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {c.dados === null
                        ? c.sub
                        : `${pct === null ? 'sem base' : `${pct.toFixed(1)}% do total`} • ${c.sub}`}
                    </p>
                    {c.dados && c.valor > 0 && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Oficial {formatTCO2e(c.dados.oficial, 2)} · Estimativa{' '}
                        {formatTCO2e(c.dados.estimado, 2)}
                      </p>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          <FaixaFontes resumo={resumo} />

          <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="p-0 mb-3">
              <CardTitle className="text-sm font-bold text-gray-900">
                Evolução Mensal das Emissões — {periodoTexto} (tCO₂e)
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Empilhado por escopo. Mês sem fatura fica em branco (lacuna); não é zero.
              </CardDescription>
            </CardHeader>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={resumo.pontos.map((p) => ({
                    label: p.label,
                    escopo1: p.escopo1 || 0,
                    escopo2: p.escopo2 || 0,
                    escopo3: p.escopo3 || 0,
                  }))}
                  margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#9CA3AF"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v.toFixed(1)}t`}
                  />
                  <RechartsTooltip
                    formatter={(val: any) => [formatTCO2e(val, 3), 'Emissões']}
                    labelFormatter={(l) => `Competência: ${l}`}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <Bar dataKey="escopo1" name="Escopo 1 (Gás)" stackId="a" fill="#14B8A6" />
                  <Bar dataKey="escopo2" name="Escopo 2 (Energia)" stackId="a" fill="#F59E0B" />
                  <Bar dataKey="escopo3" name="Escopo 3 (Água)" stackId="a" fill="#0EA5E9" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex items-start gap-2 text-[11px] text-gray-500 border-t pt-2">
              <Info className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
              <span>
                tCO₂e soma entre escopos (mesma unidade). Consumo de energia (kWh) e de água/gás
                (m³) são grandezas distintas — não se somam e não entram neste total.
              </span>
            </div>
          </Card>

          {mostrarPorEmpreendimento && resumo.breakdown.length > 1 && (
            <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
              <CardHeader className="p-0 mb-3">
                <CardTitle className="text-sm font-bold text-gray-900">
                  Emissões por Empreendimento — {periodoTexto}
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Acumulado do período. Média dividida pelos meses com fatura de cada
                  empreendimento.
                </CardDescription>
              </CardHeader>
              <div className="space-y-3">
                {resumo.breakdown.map((b, i) => {
                  const pct = total > 0 ? (b.total / total) * 100 : 0
                  return (
                    <div key={b.empreendimentoId} className="space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-semibold text-gray-800 flex items-center gap-1.5 truncate">
                          <span className="w-5 h-5 rounded-full bg-teal-50 text-teal-800 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {i + 1}
                          </span>
                          <span className="truncate">{b.nome}</span>
                        </span>
                        <span className="font-mono font-bold text-teal-900 whitespace-nowrap">
                          {formatTCO2e(b.total, 2)} ({pct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-teal-600 h-2 rounded-full"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-400">
                        <span>
                          E1 {formatTCO2e(b.escopo1, 1)} · E2 {formatTCO2e(b.escopo2, 1)} · E3{' '}
                          {formatTCO2e(b.escopo3, 1)}
                        </span>
                        <span>
                          Média {b.mediaMensal === null ? 'ND' : formatTCO2e(b.mediaMensal, 2)}/mês
                          ({b.mesesComDado} {b.mesesComDado === 1 ? 'mês' : 'meses'})
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            <Badge variant="outline" className="bg-white border-gray-200 text-gray-600 font-normal">
              Meses com fatura: {resumo.mesesComDado} de {resumo.qtdMeses}
            </Badge>
            {resumo.mesesSemDado.length > 0 && (
              <span className="text-amber-700">
                {resumo.mesesSemDado.length} mês(es) sem fatura no período — tratados como lacuna.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default GeeDashboardSection
