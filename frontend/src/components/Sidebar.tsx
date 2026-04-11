import { NavLink } from 'react-router-dom';
import { Music, LayoutDashboard, Settings } from 'lucide-react';

function Sidebar() {
  return (
    <aside className="w-64 border-r border-gray-800 bg-gray-900 flex flex-col hidden md:flex shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-gray-800 font-semibold text-lg tracking-tight text-white gap-2">
        <div className="w-8 h-8 rounded bg-primary-600 flex items-center justify-center text-white">
          <Music size={18} />
        </div>
        MediaOrganize
      </div>
      <nav className="flex-1 p-4 space-y-1">
        <NavItem icon={<LayoutDashboard size={18} />} label="Workspace" to="/" />
        <NavItem icon={<Settings size={18} />} label="Settings" to="/settings" />
      </nav>
    </aside>
  );
}

function NavItem({ icon, label, to }: { icon: React.ReactNode; label: string; to: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `w-full flex items-center gap-3 px-3 py-2 rounded-md font-medium text-sm transition-colors ${
          isActive
            ? 'bg-primary-600/10 text-primary-500'
            : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

export default Sidebar;
