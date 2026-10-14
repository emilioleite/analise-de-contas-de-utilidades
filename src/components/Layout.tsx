import React, { useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import dekazenLogo from '@/assets/monograma-dkz-2e2a6.png'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import {
  LayoutDashboard,
  Building2,
  FileText,
  TrendingUp,
  LogOut,
  Menu,
  X,
  Zap,
  Droplets,
  Flame,
  CheckCircle,
  RefreshCw,
  Settings,
  Leaf,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Empreendimentos', path: '/empreendimentos', icon: Building2 },
  { name: 'Faturas', path: '/faturas', icon: FileText },
  { name: 'Análise 24 Meses', path: '/analise-24-meses', icon: TrendingUp },
  { name: 'Emissões de GEE', path: '/emissoes', icon: Leaf },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { syncing, refreshData } = useData()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  // Current page title mapping
  const getPageTitle = () => {
    const p = location.pathname
    if (p === '/') return 'Dashboard Geral'
    if (p.startsWith('/empreendimentos')) return 'Gestão de Empreendimentos'
    if (p.startsWith('/faturas')) return 'Faturas de Utilidades'
    if (p.startsWith('/analise-24-meses')) return 'Análise de Consumo — 24 Meses'
    if (p.startsWith('/emissoes')) return 'Emissões de GEE (GHG Protocol)'
    return 'Gestor de Utilidades'
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const userName = user?.name || user?.email || 'Membro Corporativo'
  const userInitials = (user?.name || user?.email || 'GU').slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-[#F4F5F7] flex flex-col md:flex-row text-[#111827]">
      {/* Mobile Drawer Backdrop */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm md:hidden transition-opacity"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* Sidebar Desktop (260px) / Tablet Rail (72px) / Mobile Drawer (280px) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-white border-r border-[#E5E7EB] flex flex-col transition-all duration-300 ease-in-out',
          // Desktop: 260px width
          'lg:w-[260px]',
          // Tablet: 72px rail
          'md:w-[72px] lg:w-[260px]',
          // Mobile: Drawer offscreen or 280px
          mobileDrawerOpen ? 'translate-x-0 w-[280px]' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Brand Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-9 h-9 rounded-lg bg-white border border-teal-100 p-0.5 flex items-center justify-center shrink-0 shadow-xs">
              <img
                src={dekazenLogo}
                alt="Monograma Dekazen"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="hidden lg:flex flex-col truncate">
              <span className="font-bold text-sm leading-tight text-gray-900 truncate">
                Gestor de Utilidades
              </span>
              <span className="text-[10px] text-teal-700 font-semibold tracking-wide">DEKAZEN</span>
            </div>
          </div>

          {/* Close button inside mobile drawer */}
          <button
            type="button"
            className="md:hidden p-1.5 text-gray-500 hover:text-gray-900 rounded-md"
            onClick={() => setMobileDrawerOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMobileDrawerOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group relative',
                    isActive
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )
                }
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-teal-700 rounded-r-md" />
                )}
                <Icon
                  className={cn(
                    'w-5 h-5 shrink-0 transition-colors',
                    isActive ? 'text-teal-700' : 'text-gray-400 group-hover:text-gray-600',
                  )}
                />
                <span className="truncate md:hidden lg:inline">{item.name}</span>

                {/* Tablet Tooltip on hover */}
                <span className="hidden md:block lg:hidden absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                  {item.name}
                </span>
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom User Card */}
        <div className="p-3 border-t border-[#E5E7EB]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-3 p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-left"
              >
                <Avatar className="w-8 h-8 rounded-full border border-gray-200 shrink-0">
                  <AvatarFallback className="bg-teal-700 text-white font-medium text-xs">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden lg:flex flex-col truncate flex-1">
                  <span className="text-xs font-semibold text-gray-900 truncate">{userName}</span>
                  <span className="text-[10px] text-gray-400 truncate">{user?.email}</span>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 mb-2">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-xs font-semibold leading-none">{userName}</p>
                  <p className="text-[11px] leading-none text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-xs"
                onClick={() => {
                  refreshData()
                }}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-2" />
                Atualizar dados
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer text-xs text-red-600 focus:text-red-700 focus:bg-red-50"
                onClick={handleLogout}
              >
                <LogOut className="w-3.5 h-3.5 mr-2" />
                Sair do sistema
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content Wrapper (offset by sidebar width) */}
      <div className="flex-1 flex flex-col md:pl-[72px] lg:pl-[260px] min-h-screen">
        {/* Sticky Top Bar (56px) */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur border-b border-[#E5E7EB] flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {/* Hamburger Button on mobile/tablet */}
            <button
              type="button"
              className="md:hidden p-1.5 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
              {getPageTitle()}
            </h1>
          </div>

          {/* Sync indicator */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => refreshData()}
              title="Clique para sincronizar agora"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75',
                    syncing && 'animate-spin',
                  )}
                />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>{syncing ? 'Atualizando...' : 'Sincronizado'}</span>
            </button>
          </div>
        </header>

        {/* Page Content Container */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto animate-in fade-in duration-300">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
