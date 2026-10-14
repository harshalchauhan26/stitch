import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell.jsx';
import Home from './pages/Home.jsx';
import Gaps from './pages/Gaps.jsx';
import AddLead from './pages/AddLead.jsx';
import Placeholder from './pages/Placeholder.jsx';
import Login from './pages/Login.jsx';
import { useApp } from './context/AppContext.jsx';

export default function App() {
  const { auth } = useApp();
  if (auth === 'checking') return null;
  if (auth === 'out') return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/gaps" element={<Gaps />} />
        <Route path="/leads/new" element={<AddLead />} />
        <Route path="/leads" element={<Placeholder />} />
        <Route path="/leads/:id" element={<Placeholder />} />
        <Route path="/orders" element={<Placeholder />} />
        <Route path="/orders/:id" element={<Placeholder />} />
        <Route path="/settings/required" element={<Placeholder />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}