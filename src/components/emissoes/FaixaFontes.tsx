import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { formatTCO2e } from '@/lib/cnpj'
import { ResumoEmissoes } from '@/lib/emissoesPeriodo'

/**
 * Separa visualmente o que é fator oficial (GHG Protocol / IPCC 2006 / MCTI-SIRENE)
 * do que é estimativa setorial (água e esgoto, fallback de energia).
 *
 * Existe porque um total que soma os dois parece auditado quando não é.
 */
export function FaixaFontes({ resumo }: { resumo: ResumoEmissoes }) {
  if (!resumo.temDados) return null

  const pctOficial = resumo.totalPeriodo > 0 ? (resumo.totalOficial / resumo.totalPeriodo) * 100 : 0

  return (
    <div
      className={`p-3.5 rounded-xl border flex flex-col lg:flex-row lg:items-center gap-3 text-xs ${
        resumo.misturaFontes
          ? 'bg-amber-50/80 border-amber-300 text-amber-900'
          : 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
      }`}
    >
      {resumo.misturaFontes ? (
        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
      ) : (
        <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
      )}

      <div className="flex-1">
        <p className="font-bold">
          {resumo.misturaFontes
            ? 'Atenção: este total mistura fator oficial com estimativa setorial'
            : 'Total apurado somente com fatores oficiais'}
        </p>
        <p className="mt-0.5 leading-relaxed">
          <strong>{pctOficial.toFixed(1)}%</strong> do total ({formatTCO2e(resumo.totalOficial, 2)})
          vem de fator oficial — gás (IPCC 2006 / PB GHG Protocol) e energia (MCTI/SIRENE).{' '}
          <strong>{formatTCO2e(resumo.totalEstimado, 2)}</strong> vem de estimativa setorial (água e
          esgoto; fallback de energia em mês sem publicação oficial).
          {resumo.misturaFontes
            ? ' Para relatório auditado, apresente as duas parcelas separadas: o número consolidado não é inventário verificado.'
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0 text-[11px] font-semibold">
        <span className="px-2 py-1 rounded-md bg-white/80 border border-emerald-200 text-emerald-800">
          Oficial {formatTCO2e(resumo.totalOficial, 2)}
        </span>
        <span className="px-2 py-1 rounded-md bg-white/80 border border-amber-200 text-amber-800">
          Estimativa {formatTCO2e(resumo.totalEstimado, 2)}
        </span>
      </div>
    </div>
  )
}

export default FaixaFontes
