import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou uma exceção não tratada:', error, errorInfo)
    this.setState({ errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoHome = () => {
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-200 p-6 sm:p-8 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4 text-amber-600">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <h1 className="text-xl font-bold text-gray-900 tracking-tight mb-2">
              Algo não saiu como esperado
            </h1>

            <p className="text-xs sm:text-sm text-gray-600 mb-6 leading-relaxed">
              Ocorreu um imprevisto durante o carregamento desta página. Os seus dados permanecem
              seguros. Você pode tentar recarregar a página ou retornar ao início.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 mb-4">
              <Button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto bg-teal-700 hover:bg-teal-800 text-white text-xs h-9 font-medium shadow-xs flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Recarregar página
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={this.handleGoHome}
                className="w-full sm:w-auto text-xs h-9 border-gray-300 hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                <Home className="w-3.5 h-3.5" />
                Ir para o início
              </Button>
            </div>

            {this.state.error && (
              <details className="mt-4 text-left border-t border-gray-100 pt-3">
                <summary className="text-[11px] font-semibold text-gray-500 cursor-pointer hover:text-gray-700">
                  Detalhes técnicos para o suporte
                </summary>
                <div className="mt-2 p-2.5 bg-gray-50 rounded-lg text-[10px] font-mono text-gray-700 overflow-x-auto max-h-40 border border-gray-200 leading-tight">
                  <p className="font-bold text-red-600">{this.state.error.toString()}</p>
                  {this.state.errorInfo?.componentStack && (
                    <pre className="mt-1 whitespace-pre-wrap text-gray-500">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
