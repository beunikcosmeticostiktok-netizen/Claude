export type Role = 'admin' | 'gestor' | 'comercial' | 'producao' | 'estoque' | 'compras' | 'financeiro';
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador', gestor: 'Gestor', comercial: 'Comercial', producao: 'Produção',
  estoque: 'Estoque e expedição', compras: 'Compras', financeiro: 'Financeiro',
};
export const ALL_ROLES = Object.keys(ROLE_LABEL) as Role[];

export type NavItem = { href: string; label: string; roles: Role[] };
/** Somente módulos já construídos aparecem no menu. */
export const NAV: NavItem[] = [
  { href: '/', label: 'Início', roles: ALL_ROLES },
  { href: '/clientes', label: 'Clientes', roles: ALL_ROLES },
  { href: '/crm', label: 'CRM', roles: ['admin', 'gestor', 'comercial'] },
  { href: '/orcamentos', label: 'Orçamentos', roles: ['admin', 'gestor', 'comercial', 'financeiro'] },
  { href: '/pedidos', label: 'Pedidos', roles: ['admin', 'gestor', 'comercial', 'producao', 'estoque', 'financeiro'] },
  { href: '/produtos', label: 'Produtos', roles: ALL_ROLES },
  { href: '/estoque', label: 'Estoque', roles: ALL_ROLES },
  { href: '/compras', label: 'Compras', roles: ['admin', 'gestor', 'compras', 'financeiro'] },
  { href: '/recebimentos', label: 'Recebimentos', roles: ['admin', 'gestor', 'compras', 'estoque'] },
  { href: '/custos', label: 'Calculadora de custo', roles: ['admin', 'gestor', 'comercial', 'financeiro'] },
  { href: '/usuarios', label: 'Usuários', roles: ['admin'] },
];
export const canSee = (roles: Role[], allowed: Role[]) => roles.some((r) => allowed.includes(r));
