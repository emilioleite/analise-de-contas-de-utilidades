import React, { useState } from 'react'
import { useData } from '@/context/DataContext'
import { FatorEmissaoRecord } from '@/types/entities'
import { emissoesService } from '@/services/emissoes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  Flame,
  Droplets,
  Zap,
  RotateCcw,
  Plus,
  Save,
  CheckCircle2,
  AlertTriangle,
  Info,
  Sparkles,
  RefreshCw,
  Clock,
  ShieldCheck,
} from 'lucide-react'

export const FatoresEmissaoTab: React.FC = () => {
  const { fatores, updateFator, upsertFator, restaurarPadraoFatores, refreshData } = useData()
  const { toast } = useToast()

  const [sincronizando, setSincronizando] = useState(false)
  const [restaurando, setRestaurando] = useState(false)
  const [salvandoChave, setSalvandoChave] = useState<string | null>(null)
  const [modalNovoAberto, setModalNovoAberto] = useState(false)

  // Estado local para edições pontuais dos campos
  const [valoresLocais, setValoresLocais] = useState<Record<string, string>>({})

  // Form para adicionar fator mensal
  const [novoAno, setNovoAno] = useState<string>(new Date().getFullYear().toString())
  const [novoMes, setNovoMes] = useState<string>('1')
  const [novoValor, setNovoValor] = useState<string>('')
  const [novoIsOficial, setNovoIsOficial] = useState<boolean>(true)
  const [novaFonte, setNovaFonte] = useState<string>('MCTI / SIRENE')

  // Separar fatores por tipo
  const fatorFallback = fatores.find(
    (f) => f.tipo === 'energia_fallback' || f.chave === 'energia_fallback',
  )
  const fatorGas = fatores.find((f) => f.tipo === 'gas_natural' || f.chave === 'gas_natural')
  const fatorAguaAbast = fatores.find(
    (f) => f.tipo === 'agua_abastecimento' || f.chave === 'agua_abastecimento',
  )
  const fatorAguaEsg = fatores.find((f) => f.tipo === 'agua_esgoto' || f.chave === 'agua_esgoto')

  const fatoresSinMensais = fatores
    .filter((f) => f.tipo === 'energia_mensal')
    .sort((a, b) => {
      const aVal = (Number(a.ano) || 0) * 100 + (Number(a.mes) || 0)
      const bVal = (Number(b.ano) || 0) * 100 + (Number(b.mes) || 0)
      return bVal - aVal // Mais recentes primeiro
    })

  const getValorAtual = (fator?: FatorEmissaoRecord, fallbackDefault = 0) => {
    if (!fator) return fallbackDefault.toString()
    if (valoresLocais[fator.chave] !== undefined) {
      return valoresLocais[fator.chave]
    }
    return fator.valor.toString()
  }

  const handleInputChange = (chave: string, val: string) => {
    setValoresLocais((prev) => ({ ...prev, [chave]: val }))
  }

  const handleSalvarFator = async (fator?: FatorEmissaoRecord, fallbackChave?: string) => {
    const chave = fator?.chave || fallbackChave
    if (!chave) return

    const valStr = valoresLocais[chave] ?? fator?.valor?.toString() ?? '0'
    const numVal = parseFloat(valStr.replace(',', '.'))

    if (isNaN(numVal) || numVal < 0) {
      toast({
        title: 'Valor inválido',
        description: 'Informe um número positivo válido.',
        variant: 'destructive',
      })
      return
    }

    try {
      setSalvandoChave(chave)
      if (fator?.id) {
        await updateFator(fator.id, { valor: numVal })
      } else {
        await upsertFator({
          chave,
          tipo: chave as any,
          valor: numVal,
          unidade: chave.startsWith('sin') || chave.includes('energia') ? 'tCO₂/MWh' : 'kgCO₂e/m³',
        })
      }

      toast({
        title: 'Fator atualizado',
        description: `O fator ${chave} foi atualizado para ${numVal}. As emissões foram recalculadas!`,
      })
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: err.message || 'Não foi possível salvar o fator.',
        variant: 'destructive',
      })
    } finally {
      setSalvandoChave(null)
    }
  }

  const handleRestaurarPadroes = async () => {
    if (
      !window.confirm(
        'Deseja restaurar todos os fatores de emissão para os valores padrão do GHG Protocol e MCTI?',
      )
    ) {
      return
    }

    try {
      setRestaurando(true)
      await restaurarPadraoFatores()
      setValoresLocais({})
      toast({
        title: 'Fatores restaurados',
        description:
          'Os fatores padrão recomendados pelo GHG Protocol e MCTI foram redefinidos com sucesso.',
      })
    } catch (err: any) {
      toast({
        title: 'Erro ao restaurar',
        description: err.message || 'Falha ao restaurar valores padrão.',
        variant: 'destructive',
      })
    } finally {
      setRestaurando(false)
    }
  }

  const handleAdicionarMesSin = async (e: React.FormEvent) => {
    e.preventDefault()
    const anoNum = parseInt(novoAno, 10)
    const mesNum = parseInt(novoMes, 10)
    const valNum = parseFloat(novoValor.replace(',', '.'))

    if (isNaN(anoNum) || isNaN(mesNum) || isNaN(valNum) || valNum <= 0) {
      toast({
        title: 'Dados inválidos',
        description: 'Preencha ano, mês e um fator numérico positivo.',
        variant: 'destructive',
      })
      return
    }

    const chave = `sin_${anoNum}_${String(mesNum).padStart(2, '0')}`
    try {
      await upsertFator({
        chave,
        tipo: 'energia_mensal',
        ano: anoNum,
        mes: mesNum,
        valor: valNum,
        unidade: 'tCO₂/MWh',
        is_oficial: novoIsOficial,
        fonte:
          novaFonte ||
          (novoIsOficial ? 'Fator médio do SIN — MCTI/SIRENE' : 'Estimativa informada'),
        descricao: `${String(mesNum).padStart(2, '0')}/${anoNum}`,
      })

      toast({
        title: 'Fator mensal salvo',
        description: `Fator para ${String(mesNum).padStart(2, '0')}/${anoNum} cadastrado com sucesso!`,
      })
      setModalNovoAberto(false)
      setNovoValor('')
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: err.message || 'Não foi possível cadastrar o fator.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-teal-600" />
                Parâmetros e Fatores de Emissão (GHG Protocol)
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-gray-500 mt-1">
                Configure os fatores de conversão em tCO₂e por escopo e utilidade. Ao salvar
                qualquer valor, o recálculo dos 24 meses é instantâneo.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    setSincronizando(true)
                    const res = await emissoesService.sincronizarFatoresSin()
                    await refreshData()
                    toast({
                      title: 'Verificação concluída',
                      description:
                        res.aviso ||
                        `Atualização concluída: ${res.registrosInseridos || 0} novos, ${res.registrosAtualizados || 0} atualizados.`,
                    })
                  } catch (err: any) {
                    toast({
                      title: 'Aviso da rotina',
                      description:
                        err.message ||
                        'A verificação com o MCTI/SIRENE foi executada e os fatores vigentes foram mantidos.',
                    })
                  } finally {
                    setSincronizando(false)
                  }
                }}
                disabled={sincronizando}
                className="text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border-teal-300"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 mr-1.5 ${sincronizando ? 'animate-spin' : ''}`}
                />
                Verificar MCTI Agora
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleRestaurarPadroes}
                disabled={restaurando}
                className="text-xs font-semibold text-gray-700 hover:bg-gray-100 border-gray-300"
              >
                <RotateCcw className={`w-3.5 h-3.5 mr-1.5 ${restaurando ? 'animate-spin' : ''}`} />
                Restaurar Padrão
              </Button>
            </div>
          </div>

          {/* Banner de Automação Trimestral */}
          <div className="mt-4 p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <span>Atualização Trimestral Ativa</span>
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100 text-[10px] px-1.5 py-0 h-4 font-bold">
                    Automático
                  </Badge>
                </p>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Os fatores oficiais de emissão do SIN (energia elétrica) são consultados
                  automaticamente a cada 3 meses no MCTI/SIRENE (1º dia de Jan, Abr, Jul e Out). Gás
                  e Água mantêm fatores estáticos conforme metodologia GHG Protocol.
                </p>
              </div>
            </div>
            <div className="text-[11px] text-emerald-800 font-medium shrink-0 flex items-center gap-1 bg-white/70 px-2.5 py-1 rounded border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Job: atualiza-fatores-sin-trimestral</span>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Grid de Fatores Globais (Escopo 1, Escopo 2 Fallback, Escopo 3 Água) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card Escopo 1: Gás Natural */}
        <Card
          className="border-[#E5E7EB] bg-white shadow-sm flex flex-col justify-between"
          style={{ borderTop: '4px solid #14B8A6' }}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge
                variant="outline"
                className="bg-teal-50 text-teal-800 border-teal-200 text-[11px] font-bold"
              >
                Escopo 1 — Combustão
              </Badge>
              <Flame className="w-4 h-4 text-teal-600 fill-teal-600" />
            </div>
            <CardTitle className="text-base font-bold text-gray-900 mt-2">
              Gás Natural Canalizado
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              IPCC 2006 / Programa Brasileiro GHG Protocol (PCI 38,3 MJ/m³ × FEOC 15,3 tC/TJ)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-1">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
              <label className="text-xs font-semibold text-gray-700 block">
                Fator de Emissão (kgCO₂e/m³)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  className="font-mono text-sm bg-white"
                  value={getValorAtual(fatorGas, 2.15)}
                  onChange={(e) =>
                    handleInputChange(fatorGas?.chave || 'gas_natural', e.target.value)
                  }
                />
                <Button
                  size="sm"
                  className="bg-teal-700 hover:bg-teal-800 text-white shrink-0"
                  onClick={() => handleSalvarFator(fatorGas, 'gas_natural')}
                  disabled={salvandoChave === (fatorGas?.chave || 'gas_natural')}
                >
                  <Save className="w-3.5 h-3.5 mr-1" />
                  Salvar
                </Button>
              </div>
              <p className="text-[11px] text-gray-500">
                Padrão recomendado: <strong>2,15 kgCO₂e/m³</strong>. Consumo considerado: corrigido
                (fallback medido).
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card Escopo 2: Energia Elétrica (Fallback) */}
        <Card
          className="border-[#E5E7EB] bg-white shadow-sm flex flex-col justify-between"
          style={{ borderTop: '4px solid #F59E0B' }}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge
                variant="outline"
                className="bg-amber-50 text-amber-800 border-amber-200 text-[11px] font-bold"
              >
                Escopo 2 — Eletricidade
              </Badge>
              <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
            </div>
            <CardTitle className="text-base font-bold text-gray-900 mt-2">
              Energia Elétrica (Fallback Anual)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Estimativa provisória configurável para meses sem valor publicado pelo MCTI
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-1">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
              <label className="text-xs font-semibold text-gray-700 block">
                Fator de Fallback (tCO₂/MWh)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  className="font-mono text-sm bg-white"
                  value={getValorAtual(fatorFallback, 0.05)}
                  onChange={(e) =>
                    handleInputChange(fatorFallback?.chave || 'energia_fallback', e.target.value)
                  }
                />
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                  onClick={() => handleSalvarFator(fatorFallback, 'energia_fallback')}
                  disabled={salvandoChave === (fatorFallback?.chave || 'energia_fallback')}
                >
                  <Save className="w-3.5 h-3.5 mr-1" />
                  Salvar
                </Button>
              </div>
              <p className="text-[11px] text-amber-700 font-medium">
                Padrão recomendado: <strong>0,0500 tCO₂/MWh</strong> (50 kgCO₂/MWh). Usado somente
                quando o mês não possui publicação oficial.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card Escopo 3: Água e Esgoto Composto */}
        <Card
          className="border-[#E5E7EB] bg-white shadow-sm flex flex-col justify-between"
          style={{ borderTop: '4px solid #0EA5E9' }}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge
                variant="outline"
                className="bg-sky-50 text-sky-800 border-sky-200 text-[11px] font-bold"
              >
                Escopo 3 — Outros Indiretos
              </Badge>
              <Droplets className="w-4 h-4 text-sky-500 fill-sky-500" />
            </div>
            <CardTitle className="text-base font-bold text-gray-900 mt-2">
              Água e Esgoto (Fator Composto)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Prática do PB GHG Protocol (não há fator oficial único brasileiro; valores editáveis)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                  Abastecimento (kgCO₂e/m³) [default 0,208]
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    className="font-mono text-xs bg-white h-8"
                    value={getValorAtual(fatorAguaAbast, 0.208)}
                    onChange={(e) =>
                      handleInputChange(
                        fatorAguaAbast?.chave || 'agua_abastecimento',
                        e.target.value,
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    onClick={() => handleSalvarFator(fatorAguaAbast, 'agua_abastecimento')}
                    disabled={salvandoChave === (fatorAguaAbast?.chave || 'agua_abastecimento')}
                  >
                    Salvar
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                  Tratamento Esgoto (kgCO₂e/m³) [default 0,700]
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    className="font-mono text-xs bg-white h-8"
                    value={getValorAtual(fatorAguaEsg, 0.7)}
                    onChange={(e) =>
                      handleInputChange(fatorAguaEsg?.chave || 'agua_esgoto', e.target.value)
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    onClick={() => handleSalvarFator(fatorAguaEsg, 'agua_esgoto')}
                    disabled={salvandoChave === (fatorAguaEsg?.chave || 'agua_esgoto')}
                  >
                    Salvar
                  </Button>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-700">Fator Total Composto:</span>
                <span className="font-bold text-sky-700 font-mono">
                  {(
                    parseFloat((getValorAtual(fatorAguaAbast, 0.208) || '0').replace(',', '.')) +
                    parseFloat((getValorAtual(fatorAguaEsg, 0.7) || '0').replace(',', '.'))
                  ).toFixed(3)}{' '}
                  kgCO₂e/m³
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Fatores Mensais Oficiais do SIN (MCTI) */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
                Fatores Médios Mensais do SIN — MCTI / SIRENE (Escopo 2 Location-Based)
              </CardTitle>
              <CardDescription className="text-xs text-gray-500 mt-0.5">
                Valores oficiais calculados e divulgados pelo Ministério da Ciência, Tecnologia e
                Inovação para inventários corporativos.
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => setModalNovoAberto(true)}
              className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Adicionar Mês do SIN
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Mês / Ano</th>
                    <th className="py-2.5 px-3">Fator (tCO₂/MWh)</th>
                    <th className="py-2.5 px-3">Fator (kg CO₂/MWh)</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Fonte / Metodologia</th>
                    <th className="py-2.5 px-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {fatoresSinMensais.map((fator) => {
                    const isOficial = !!fator.is_oficial
                    const valorEmKg = (fator.valor * 1000).toFixed(1)
                    const mesFormatado = `${String(fator.mes).padStart(2, '0')}/${fator.ano}`

                    return (
                      <tr key={fator.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-gray-900">{mesFormatado}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <Input
                              type="text"
                              className="w-24 h-7 text-xs font-mono bg-white"
                              value={getValorAtual(fator)}
                              onChange={(e) => handleInputChange(fator.chave, e.target.value)}
                            />
                            <span className="text-gray-400 text-[10px]">tCO₂/MWh</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-gray-700">{valorEmKg} kg/MWh</td>
                        <td className="py-2.5 px-3">
                          {isOficial ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 text-[10px] gap-1 font-semibold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Oficial MCTI
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] gap-1 font-semibold"
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                              Estimado / Manual
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-500 text-[11px] truncate max-w-xs">
                          {fator.fonte || 'MCTI / SIRENE'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-teal-700 hover:text-teal-800 hover:bg-teal-50"
                            onClick={() => handleSalvarFator(fator)}
                            disabled={salvandoChave === fator.chave}
                          >
                            <Save className="w-3 h-3 mr-1" />
                            Atualizar
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mt-3 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <span>
              Meses não cadastrados nesta tabela utilizarão automaticamente o{' '}
              <strong>Fator de Fallback Anual (0,0500 tCO₂/MWh)</strong> até que a publicação
              oficial seja inserida.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Modal Adicionar Novo Fator Mensal do SIN */}
      <Dialog open={modalNovoAberto} onOpenChange={setModalNovoAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              Cadastrar Fator Mensal do SIN (MCTI)
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Insira o fator de emissão do Sistema Interligado Nacional para o mês desejado.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdicionarMesSin} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Ano</label>
                <Input
                  type="number"
                  required
                  value={novoAno}
                  onChange={(e) => setNovoAno(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Mês (1 a 12)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="12"
                  required
                  value={novoMes}
                  onChange={(e) => setNovoMes(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                Fator em tCO₂/MWh (ex: 0,0237 ou 23,7 kg/MWh ÷ 1000)
              </label>
              <Input
                type="text"
                required
                placeholder="0.0250"
                value={novoValor}
                onChange={(e) => setNovoValor(e.target.value)}
                className="text-xs font-mono"
              />
              <span className="text-[10px] text-gray-400 mt-0.5 block">
                Dica: se tiver o valor em kg CO₂/MWh divulgado pelo MCTI, divida por 1.000.
              </span>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                Fonte / Referência
              </label>
              <Input
                type="text"
                value={novaFonte}
                onChange={(e) => setNovaFonte(e.target.value)}
                className="text-xs"
                placeholder="Fator médio do SIN — MCTI/SIRENE"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="checkOficial"
                checked={novoIsOficial}
                onChange={(e) => setNovoIsOficial(e.target.checked)}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <label htmlFor="checkOficial" className="text-xs text-gray-700 font-medium">
                Publicação oficial do MCTI / SIRENE
              </label>
            </div>

            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModalNovoAberto(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
              >
                Salvar Fator
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
export default FatoresEmissaoTab
