import React, { useState } from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { 
  LayoutDashboard, 
  Layers, 
  Package, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  History, 
  LogOut, 
  Menu, 
  X,
  Search,
  User as UserIcon,
  TrendingUp,
  BarChart3,
  Settings,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  FileText
} from 'lucide-react';
import { useAuth } from '../App';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LayoutProps {
  children: React.ReactNode;
  currentView: string;
  setView: (view: string) => void;
}

export default function Layout({ children, currentView, setView }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(['categories', 'items', 'transactions', 'stock', 'leads-data', 'projects-data'].includes(currentView));
  const { profile } = useAuth();

  React.useEffect(() => {
    if (['categories', 'items', 'transactions', 'stock', 'leads-data', 'projects-data'].includes(currentView)) {
      setIsSettingsOpen(true);
    }
  }, [currentView]);

  const mainMenuItems = [
    { id: 'lead-analytics', label: 'Lead Analytics', icon: BarChart3 },
    { id: 'project-analytics', label: 'Project Analytics', icon: BarChart3 },
    { id: 'stock-report', label: 'Stock Report', icon: BarChart3 },
    { id: 'site-material-report', label: 'Site Material Report', icon: BarChart3 },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];

  const settingsItems = [
    { id: 'categories', label: 'Categories', icon: Layers },
    { id: 'items', label: 'Products', icon: Package },
    { id: 'transactions', label: 'Transactions', icon: History },
    { id: 'stock', label: 'Current Stock', icon: ArrowDownCircle },
    { id: 'leads-data', label: 'Leads Data', icon: FileText },
    { id: 'projects-data', label: 'Projects Data', icon: FileText },
  ];

  const handleSignOut = () => {
    signOut(auth);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Desktop */}
      <aside className={cn(
        "hidden lg:flex flex-col bg-white text-slate-900 fixed h-full transition-all duration-300 ease-in-out z-40 border-r border-slate-200",
        isSidebarCollapsed ? "w-20" : "w-64"
      )}>
        <div className={cn(
          "p-4 flex items-center border-b border-slate-100 h-16 shrink-0",
          isSidebarCollapsed ? "justify-center" : "px-6 gap-3"
        )}>
          <div className="bg-blue-600 p-2 rounded-lg shrink-0 text-white">
            <Package size={20} />
          </div>
          {!isSidebarCollapsed && (
            <span className="text-lg font-bold tracking-tight truncate text-slate-900">Bharat Natural Elements</span>
          )}
        </div>
        
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
          {mainMenuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={isSidebarCollapsed ? item.label : undefined}
              className={cn(
                "w-full flex items-center rounded-xl transition-all duration-200",
                isSidebarCollapsed ? "justify-center p-3" : "gap-3 px-4 py-2.5",
                currentView === item.id 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                  : "text-slate-500 hover:text-blue-600 hover:bg-blue-50"
              )}
            >
              <item.icon size={20} className="shrink-0" />
              {!isSidebarCollapsed && (
                <span className="font-medium text-sm truncate">{item.label}</span>
              )}
            </button>
          ))}

          <div className="pt-2">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={cn(
                "w-full flex items-center rounded-xl transition-all duration-200",
                isSidebarCollapsed ? "justify-center p-3" : "gap-3 px-4 py-2.5",
                (settingsItems.some(i => i.id === currentView) || isSettingsOpen)
                  ? "text-blue-600 bg-blue-50" 
                  : "text-slate-500 hover:text-blue-600 hover:bg-blue-50"
              )}
            >
              <Settings size={20} className="shrink-0" />
              {!isSidebarCollapsed && (
                <>
                  <span className="font-medium text-sm flex-1 text-left">Settings</span>
                  {isSettingsOpen ? <ChevronDown size={16} /> : <ChevronRightIcon size={16} />}
                </>
              )}
            </button>

            {isSettingsOpen && !isSidebarCollapsed && (
              <div className="mt-1 ml-4 pl-4 border-l border-slate-100 space-y-1">
                {settingsItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-all duration-200",
                      currentView === item.id 
                        ? "text-blue-600 bg-blue-50 font-bold" 
                        : "text-slate-500 hover:text-blue-600 hover:bg-slate-50"
                    )}
                  >
                    <item.icon size={16} />
                    <span className="text-xs">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="p-3 border-t border-slate-100">
          <button
            onClick={handleSignOut}
            title={isSidebarCollapsed ? "Sign Out" : undefined}
            className={cn(
              "w-full flex items-center text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all",
              isSidebarCollapsed ? "justify-center p-3" : "gap-3 px-4 py-2.5"
            )}
          >
            <LogOut size={20} className="shrink-0" />
            {!isSidebarCollapsed && (
              <span className="font-medium text-sm">Sign Out</span>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside className={cn(
        "lg:hidden fixed inset-y-0 left-0 w-72 bg-white text-slate-900 z-50 transform transition-transform duration-300 ease-in-out border-r border-slate-200",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <Package size={24} />
            </div>
            <span className="text-xl font-bold text-slate-900">Bharat Natural</span>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>
        <nav className="p-4 space-y-1">
          {mainMenuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setView(item.id);
                setIsSidebarOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                currentView === item.id 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                  : "text-slate-500 hover:text-blue-600 hover:bg-blue-50"
              )}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}

          <div className="pt-2">
            <div className="px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Settings</div>
            {settingsItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                  currentView === item.id 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                    : "text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                )}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="p-4 border-t border-slate-100 absolute bottom-0 w-full">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
          >
            <LogOut size={20} />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className={cn(
        "flex-1 flex flex-col min-h-screen transition-all duration-300 ease-in-out",
        "lg:ml-64",
        isSidebarCollapsed && "lg:ml-20"
      )}>
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button 
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              onClick={() => {
                if (window.innerWidth >= 1024) {
                  setIsSidebarCollapsed(!isSidebarCollapsed);
                } else {
                  setIsSidebarOpen(true);
                }
              }}
            >
              <Menu size={20} />
            </button>
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="Search inventory..." 
                className="pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-64 text-sm transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end hidden sm:flex">
              <span className="text-sm font-semibold text-slate-900">{profile?.email}</span>
              <span className="text-xs text-slate-500 capitalize">{profile?.role === 'admin' ? 'Management' : 'Staff'}</span>
            </div>
            <div className="bg-slate-100 p-2 rounded-full border border-slate-200">
              <UserIcon size={20} className="text-slate-600" />
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
