import React from 'react'
import { Zap, Droplets, Flame } from 'lucide-react'

interface CenteredCardLayoutProps {
  children: React.ReactNode
  title: string
  subtitle?: string
}

export const CenteredCardLayout: React.FC<CenteredCardLayoutProps> = ({
  children,
  title,
  subtitle,
}) => {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-slate-50 overflow-hidden">
      {/* Background soft mesh decoration */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-teal-100 rounded-full filter blur-3xl opacity-60 animate-pulse" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-amber-100 rounded-full filter blur-3xl opacity-50" />
      <div className="absolute top-1/2 left-1/3 -translate-y-1/2 w-80 h-80 bg-sky-100 rounded-full filter blur-3xl opacity-40" />

      {/* Main card */}
      <div className="relative w-full max-w-[440px] bg-white rounded-2xl shadow-xl border border-gray-200 p-8 z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex items-center justify-center gap-1.5 p-3 rounded-2xl bg-teal-50 border border-teal-100 mb-3 text-teal-700">
            <Zap className="w-5 h-5 text-amber-500 fill-amber-500" />
            <Droplets className="w-5 h-5 text-sky-500 fill-sky-500" />
            <Flame className="w-5 h-5 text-teal-600 fill-teal-600" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">Gestor de Utilidades</h1>
          <p className="text-sm text-gray-500 mt-1">{title}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
        </div>

        {children}
      </div>
    </div>
  )
}
