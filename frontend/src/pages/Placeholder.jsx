import { Link, useLocation, useParams } from 'react-router-dom';

const PHASE = {
  leads: ['Leads Kanban + Lead drawer + Add Lead form', 'Phase 4', 'GET /api/leads, GET/PATCH /api/leads/:id, POST /api/leads/:id/move, POST /api/leads'],
  orders: ['Orders Kanban + Order drawer + escalation form', 'Phase 4', 'GET /api/orders, GET/PATCH /api/orders/:id, POST /api/orders/:id/move'],
  settings: ['Settings → Set Required grid', 'Phase 4', 'GET /api/rules, PUT /api/rules'],
};

export default function Placeholder() {
  const { pathname } = useLocation();
  const { id } = useParams();
  const key = pathname.split('/')[1];
  const [title, phase, api] = PHASE[key] || ['This screen', 'a later phase', ''];
  return (
    <main className="ph">
      <span className="lbl">{phase}</span>
      <h1 className="ttl">{title}</h1>
      <p style={{ margin: 0, color: 'var(--ink2)', maxWidth: 560 }}>
        This screen is referenced by the design but was not part of the exported file (only Home and Gaps were).
        The backend for it already exists.{id ? ` You opened ${id}.` : ''}
      </p>
      {api && <code className="m mut" style={{ fontSize: 12 }}>{api}</code>}
      <Link className="btn" to="/">Back to Home</Link>
    </main>
  );
}