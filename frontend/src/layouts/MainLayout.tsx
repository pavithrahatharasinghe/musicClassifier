import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

function MainLayout() {
  return (
    <div className="flex h-screen bg-gray-900 text-gray-200">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-[#0f1522] overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

export default MainLayout;
