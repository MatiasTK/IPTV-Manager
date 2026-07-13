import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthContext, useAuthProvider, useAuth } from '@/hooks/use-auth'
import { AppLayout } from '@/components/layout/app-layout'
import LoginPage from '@/pages/login'
import ChannelsPage from '@/pages/channels'
import GroupsPage from '@/pages/groups'
import SourcesPage from '@/pages/sources'
import HealthPage from '@/pages/health'
import DuplicatesPage from '@/pages/duplicates'
import RawEditorPage from '@/pages/raw-editor'
import SettingsPage from '@/pages/settings'
import CheckerPage from '@/pages/checker'

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
