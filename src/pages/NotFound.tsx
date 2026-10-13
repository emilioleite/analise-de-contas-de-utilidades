import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FileQuestion } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 text-center">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-sm border border-gray-200 space-y-4">
        <div className="w-14 h-14 bg-teal-50 text-teal-700 rounded-full flex items-center justify-center mx-auto">
          <FileQuestion className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Página não encontrada</h2>
        <p className="text-xs text-gray-500">
          A rota solicitada não existe ou não está mais disponível no sistema de utilidades.
        </p>
        <div className="pt-2">
          <Link to="/">
            <Button className="w-full bg-teal-700 hover:bg-teal-800 text-white text-xs">
              Voltar ao Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
