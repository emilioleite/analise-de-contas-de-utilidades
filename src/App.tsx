/* Main App Component - Handles routing (using react-router-dom), query client and other providers */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/context/AuthContext'
import { DataProvider } from '@/context/DataContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// Pages
import Index from './pages/Index'
import Empreendimentos from './pages/Empreendimentos'
import Faturas from './pages/Faturas'
import Analise24Meses from './pages/Analise24Meses'
import Emissoes from './pages/Emissoes'
import Usuarios from './pages/Usuarios'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import ConfirmEmailChange from './pages/ConfirmEmailChange'
import NotFound from './pages/NotFound'

const App = () => (
  <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <DataProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Routes>
              {/* Public Authentication Pages */}
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />

              {/* Protected Routes wrapped in Global Layout */}
              <Route
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<Index />} />
                <Route path="/empreendimentos" element={<Empreendimentos />} />
                <Route path="/faturas" element={<Faturas />} />
                <Route path="/analise-24-meses" element={<Analise24Meses />} />
                <Route path="/emissoes" element={<Emissoes />} />
                <Route path="/usuarios" element={<Usuarios />} />
              </Route>

              {/* Fallback 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TooltipProvider>
        </DataProvider>
      </AuthProvider>
    </BrowserRouter>
  </ErrorBoundary>
)

export default App
