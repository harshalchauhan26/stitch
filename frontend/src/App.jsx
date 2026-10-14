import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell.jsx';
import Home from './pages/Home.jsx';
import Gaps from './pages/Gaps.jsx';
import AddLead from './pages/AddLead.jsx';
import Board from './pages/Board.jsx';
import Settings from './pages/Settings.jsx';
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
        <Route path="/leads" element={<Board type="lead" />} />
        <Route path="/leads/:id" element={<Board type="lead" />} />
        <Route path="/orders" element={<Board type="order" />} />
        <Route path="/orders/:id" element={<Board type="order" />} />
        <Route path="/settings" element={<Navigate to="/settings/required" replace />} />
        <Route path="/settings/:tab" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
