import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Keywords from './pages/Keywords';
import Articles from './pages/Articles';
import CrawlLogs from './pages/CrawlLogs';
import Settings from './pages/Settings';
import AppLayout from './components/Layout';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('wechat_monitor_auth');
    if (saved) {
      setIsLoggedIn(true);
    }
    setLoading(false);
  }, []);

  const handleLogin = () => {
    localStorage.setItem('wechat_monitor_auth', 'true');
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('wechat_monitor_auth');
    setIsLoggedIn(false);
  };

  if (loading) return null;

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <AppLayout onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/keywords" element={<Keywords />} />
        <Route path="/articles" element={<Articles />} />
        <Route path="/logs" element={<CrawlLogs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default App;
