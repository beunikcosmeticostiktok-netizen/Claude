'use client';
import { useEffect, useMemo, useState } from 'react';
import { placeOrder } from './actions';

export type Product = {
  item_id: string; sku: string; name: string; description: string | null; category: string | null; image_url: string | null;
  min_qty: number; qty_multiple: number; price: number; available: number;
};
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const KEY = 'cs_loja_carrinho';

export function Shop({ products, max }: { products: Product[]; max: number }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  useEffect(() => { try { setCart(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* carrinho vazio */ } }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* sem armazenamento */ } }, [cart]);
  const byId = useMemo(() => new Map(products.map((p) => [p.item_id, p])), [products]);
  const lines = Object.entries(cart).filter(([id, q]) => byId.has(id) && q > 0).map(([id, qty]) => ({ p: byId.get(id)!, qty }));
  const total = lines.reduce((s, l) => s + l.qty * Number(l.p.price), 0);
  const step = (p: Product) => Math.max(p.qty_multiple, 1);
  const lowest = (p: Product) => Math.ceil(Math.max(p.min_qty, 1) / step(p)) * step(p);
  const setQty = (p: Product, q: number) => setCart((c) => ({ ...c, [p.item_id]: q <= 0 ? 0 : Math.min(q, max, p.available) }));
  const problem = lines.find((l) => l.qty < p0(l.p) || l.qty % step(l.p) !== 0);
  function p0(p: Product) { return Math.max(p.min_qty, 1); }
  const [mode, setMode] = useState('fob');

  return (
    <>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <section>
          <h2>Produtos</h2>
          {!products.length && <p className="muted">Nenhum produto disponível no momento.</p>}
          {products.map((p) => (
            <div className="card" key={p.item_id} style={{ marginBottom: 10 }}>
              {p.image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.image_url} alt={p.name} style={{ maxWidth: 120, float: 'right' }} />}
              <b>{p.name}</b> <span className="muted small">{p.sku}</span>
              {p.description && <p className="small">{p.description}</p>}
              <p><b>{brl(Number(p.price))}</b> / peça · <span className="muted small">{p.available > 0 ? `${p.available} em estoque` : 'sem estoque'}
                {p.min_qty > 1 ? ` · mínimo ${p.min_qty}` : ''}{p.qty_multiple > 1 ? ` · múltiplos de ${p.qty_multiple}` : ''}</span></p>
              {p.available >= lowest(p) ? (
                <div className="inline">
                  <input type="number" min={0} max={Math.min(max, p.available)} step={step(p)} value={cart[p.item_id] ?? 0}
                    onChange={(e) => setQty(p, Number(e.target.value))} style={{ width: 100 }} />
                  <button type="button" className="btn sm" onClick={() => setQty(p, (cart[p.item_id] ?? 0) === 0 ? lowest(p) : (cart[p.item_id] ?? 0) + step(p))}>Adicionar</button>
                </div>
              ) : <span className="badge">Indisponível</span>}
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Seu pedido</h2>
          {!lines.length && <p className="muted">Carrinho vazio.</p>}
          {lines.map((l) => <p key={l.p.item_id}>{l.qty} × {l.p.name} — {brl(l.qty * Number(l.p.price))}</p>)}
          {lines.length > 0 && <p><b>Total: {brl(total)}</b> <span className="muted small">(sem frete)</span></p>}
          {problem && <div className="alert err">Ajuste a quantidade de “{problem.p.name}” (mínimo {Math.max(problem.p.min_qty, 1)}, múltiplos de {step(problem.p)}).</div>}
          <form action={placeOrder} className="stack">
            <input type="hidden" name="cart" value={JSON.stringify(lines.map((l) => ({ item_id: l.p.item_id, qty: l.qty })))} />
            <label>Nome ou razão social<input name="name" required /></label>
            <label>CPF ou CNPJ<input name="tax_id" required inputMode="numeric" /></label>
            <label>WhatsApp / telefone<input name="phone" inputMode="tel" /></label>
            <label>E-mail<input name="email" type="email" /></label>
            <label>Frete
              <select name="freight_mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="fob">Transportadora indicada por mim (FOB)</option><option value="retirada">Retirada na fábrica</option>
              </select></label>
            {mode === 'fob' && <label>Nome da transportadora<input name="carrier_name" required /></label>}
            <label>Observação<textarea name="note" maxLength={500} rows={2} /></label>
            <button className="btn full" type="submit" disabled={!lines.length || Boolean(problem)}>Finalizar e pagar</button>
            <p className="muted small">Ao finalizar, o estoque fica reservado até a confirmação do pagamento. Nota fiscal emitida pela empresa.</p>
          </form>
        </section>
      </div>
    </>
  );
}
