import { Outlet } from 'react-router'
import { Sidebar } from './sidebar'
import { cn } from '@/lib/utils'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      {/* Main content — offset for sidebar */}
      <main
        className={cn(
          'flex-1 min-h-screen overflow-auto',
          'md:ml-60 transition-all duration-300', // matches sidebar width
          'p-6 md:p-8'
        )}
        id="main-content"
      >
        <div className="max-w-7xl mx-auto animate-fade-in-up">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
