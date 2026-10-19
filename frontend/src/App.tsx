import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthContext, useAuthProvider, useAuth } from '@/hooks/use-auth'
import { AppLayout } from '@/components/layout/app-layout'
import LoginPage from '@/pages/login'

const ChannelsPage = lazy(() => import('@/pages/channels'))
const GroupsPage = lazy(() => import('@/pages/groups'))
const SourcesPage = lazy(() => import('@/pages/sources'))
const HealthPage = lazy(() => import('@/pages/health'))
const DuplicatesPage = lazy(() => import('@/pages/duplicates'))
const PublishPage = lazy(() => import('@/pages/publish'))
const RawEditorPage = lazy(() => import('@/pages/raw-editor'))
const SettingsPage = lazy(() => import('@/pages/settings'))
const CheckerPage = lazy(() => import('@/pages/checker'))

// Fetch the other pages' chunks once the browser is idle so sidebar clicks never wait on the network
const pageLoaders = [
  () => import('@/pages/channels'), () => import('@/pages/groups'), () => import('@/pages/sources'),
  () => import('@/pages/health'), () => import('@/pages/duplicates'), () => import('@/pages/publish'),
  () => import('@/pages/raw-editor'), () => import('@/pages/settings'), () => import('@/pages/checker'),
]
const whenIdle = (fn: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn) : setTimeout(fn, 1500))
whenIdle(() => pageLoaders.forEach((load) => { load() }))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

// Uses AuthContext — must be inside AuthProvider
function AppRoutes() {
  const { user, isLoading } = useAuth()

  if (isLoading) return <LoadingSpinner />

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/channels" replace /> : <LoginPage />}
      />
      <Route element={user ? <AppLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<Navigate to="/channels" replace />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/duplicates" element={<DuplicatesPage />} />
        <Route path="/publish" element={<PublishPage />} />
        <Route path="/raw-editor" element={<RawEditorPage />} />
        <Route path="/checker" element={<CheckerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/channels" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <AppRoutes />
            <Toaster position="bottom-right" theme="dark" />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
