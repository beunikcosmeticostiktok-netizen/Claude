import { createAdminClient } from '@/lib/supabase/server';
import { dbErrorText } from '@/lib/labels';
import { Shop, type Product } from './Shop';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Loja · Century Shalom' };

export default async function Loja({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const admin = createAdminClient();
  await admin.rpc('store_expire_unpaid');
  const { data, error } = await admin.rpc('store_catalog');
  const products = (data ?? []) as Product[];
  const max = Number((await admin.from('settings').select('value').eq('key', 'loja_max_qty_por_pedido').maybeSingle()).data?.value ?? 300);
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <h1>Loja Century Shalom</h1>
      <p className="muted">Produtos de pronta entrega. Até {max} peças por produto em cada compra; para quantidades maiores, fale com um vendedor.
        Pagamento à vista. O frete é por sua conta (transportadora indicada por você ou retirada na fábrica).</p>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {error && <div className="alert err">Loja indisponível no momento.</div>}
      <Shop products={products} max={max} />
    </main>
  );
}
