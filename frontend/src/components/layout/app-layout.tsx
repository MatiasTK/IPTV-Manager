import { Outlet } from 'react-router'
import { Sidebar } from './sidebar'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main id="main-content" className="min-h-screen min-w-0 px-4 pt-16 pb-8 md:ml-[232px] md:px-8 md:pt-7">
        <div className="flex flex-col gap-[22px]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
