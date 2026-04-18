import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import QualityAnalyzer from './pages/QualityAnalyzer';
import Download from './pages/Download';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/quality" element={<QualityAnalyzer />} />
          <Route path="/download" element={<Download />} />
          <Route path="/settings" element={<Settings />} />
          {/* Catch-all: redirect unknown paths to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
