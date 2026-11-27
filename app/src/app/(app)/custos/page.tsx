import { requireRole } from '@/lib/auth';
import { Calculadora } from './Calculadora';

export default async function Custos() {
  await requireRole(['admin', 'gestor', 'comercial', 'financeiro']);
  return (
    <>
      <div className="top"><h1>Calculadora de custo</h1></div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        Calcula o custo completo e o preço mínimo de uma peça (markup sobre o custo completo; imposto do Simples dentro do markup).
        Despesas fixas são rateadas por hora-máquina produtiva.
      </p>
      <Calculadora />
    </>
  );
}
