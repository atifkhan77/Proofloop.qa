import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Menu, X, Sun, Moon, Monitor, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PageLoader from '@/components/layout/PageLoader';
import { navigation } from '@/config/navigation';
import { useTheme, type Theme } from '@/contexts/theme-context';
import { useAuth } from '@/contexts/auth-context';

const themeCycle: Record<Theme, { next: Theme; icon: typeof Sun; label: string }> = {
  dark: { next: 'light', icon: Moon, label: 'Dark theme (switch to light)' },
  light: { next: 'system', icon: Sun, label: 'Light theme (switch to system)' },
  system: { next: 'dark', icon: Monitor, label: 'System theme (switch to dark)' },
};

function SidebarContent() {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-sidebar-border">
        <span className="bg-linear-to-r from-accent-blue to-accent-purple bg-clip-text text-xl font-bold text-transparent">
          PROOFLOOP QA
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4" aria-label="Main">
        {navigation.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cn(
                'group flex items-center rounded-md px-2 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  aria-hidden="true"
                  className={cn(
                    'mr-3 h-5 w-5 shrink-0',
                    isActive ? 'text-accent-cyan' : 'text-sidebar-foreground group-hover:text-accent-cyan',
                  )}
                />
                {item.name}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const themeButton = themeCycle[theme];

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setSidebarOpen(false), [pathname]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSidebarOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="relative flex h-full w-64 flex-col bg-sidebar shadow-xl">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
              className="absolute top-3 right-2 text-sidebar-foreground"
            >
              <X />
            </Button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarContent />
      </aside>

      {/* Main content */}
      <div className="flex w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-border bg-background px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
          >
            <Menu />
          </Button>

          <div className="flex flex-1 justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => setTheme(themeButton.next)}
              aria-label={themeButton.label}
              title={themeButton.label}
            >
              <themeButton.icon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="ml-2 rounded-full"
              onClick={logout}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut />
            </Button>
          </div>
        </header>

        <main className="relative flex-1 overflow-y-auto focus:outline-none">
          <div className="px-4 py-6 sm:px-6 md:px-8">
            {/* Keeps sidebar/header mounted while a lazy page chunk loads. */}
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
