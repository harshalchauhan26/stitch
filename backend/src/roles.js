// Roles from the Field & Flow doc: Sales associate, Ops, QC, Pod lead, Admin.
export const ROLES = ['admin', 'pod_lead', 'sales', 'ops', 'qc'];
export const ROLE_LABEL = { admin: 'Admin', pod_lead: 'Pod lead', sales: 'Sales associate', ops: 'Ops', qc: 'QC' };
export const isAdmin = (u) => u.role === 'admin';
export const canEditRules = (u) => u.role === 'admin' || u.role === 'pod_lead';