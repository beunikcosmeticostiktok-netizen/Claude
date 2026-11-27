import { ITEM_TYPES, type Tier } from '@/lib/items';
import { saveItem } from './actions';

type Item = {
  id: string; type: string; sku: string; name: string; description: string | null; category: string | null;
  uom: string; weight_g: number | null; capacity_ml: number | null; dimensions: Record<string, number | null> | null;
  material: string | null; finish: string | null; min_qty: number; qty_multiple: number; lead_time_days: number | null;
  store_published: boolean; active: boolean; internal_notes: string | null;
};

export function ItemForm({ item, tiers, prices }: { item?: Item; tiers: Tier[]; prices: Record<number, number> }) {
  const d = item?.dimensions ?? {};
  const v = (x: unknown) => (x == null ? '' : String(x));
  return (
    <form action={saveItem} className="card stack">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="grid2">
        <label>Código (SKU)<input name="sku" required defaultValue={item?.sku} placeholder="ex.: FRS-250" /></label>
        <label>Tipo
          <select name="type" defaultValue={item?.type ?? 'produto_acabado'}>
            {ITEM_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="grid2">
        <label>Nome<input name="name" required defaultValue={item?.name} /></label>
        <label>Categoria<input name="category" defaultValue={item?.category ?? ''} placeholder="pets, cabelo, embalagens, tampas…" /></label>
      </div>
      <label>Descrição<textarea name="description" rows={2} defaultValue={item?.description ?? ''} /></label>

      <h2>Especificações</h2>
      <div className="grid2">
        <label>Material<input name="material" defaultValue={item?.material ?? ''} placeholder="PEAD, PP, PET…" /></label>
        <label>Acabamento / cor padrão<input name="finish" defaultValue={item?.finish ?? ''} /></label>
      </div>
      <div className="grid2">
        <label>Peso (g)<input name="weight_g" inputMode="decimal" defaultValue={v(item?.weight_g)} /></label>
        <label>Capacidade (ml)<input name="capacity_ml" inputMode="decimal" defaultValue={v(item?.capacity_ml)} /></label>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <label>Comprimento (mm)<input name="comprimento_mm" inputMode="decimal" defaultValue={v(d.comprimento_mm)} /></label>
        <label>Largura (mm)<input name="largura_mm" inputMode="decimal" defaultValue={v(d.largura_mm)} /></label>
        <label>Altura (mm)<input name="altura_mm" inputMode="decimal" defaultValue={v(d.altura_mm)} /></label>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <label>Unidade<input name="uom" defaultValue={item?.uom ?? 'un'} /></label>
        <label>Qtd. mínima<input name="min_qty" inputMode="numeric" defaultValue={v(item?.min_qty ?? 1)} /></label>
        <label>Múltiplo de venda<input name="qty_multiple" inputMode="numeric" defaultValue={v(item?.qty_multiple ?? 1)} /></label>
        <label>Prazo (dias)<input name="lead_time_days" inputMode="numeric" defaultValue={v(item?.lead_time_days)} /></label>
      </div>

      <h2>Preço de venda por quantidade (R$ por unidade)</h2>
      <p className="muted small" style={{ marginTop: -6 }}>Cinco faixas definidas pela empresa. Deixe em branco a faixa que ainda não tem preço.</p>
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        {tiers.map((t) => (
          <label key={t.id}>{t.label} peças
            <input name={`price_${t.id}`} inputMode="decimal" placeholder="0,00" defaultValue={prices[t.id] != null ? String(prices[t.id]).replace('.', ',') : ''} />
          </label>
        ))}
      </div>

      <label>Observações internas (nunca aparecem para o cliente)<textarea name="internal_notes" rows={2} defaultValue={item?.internal_notes ?? ''} /></label>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
          <input type="checkbox" name="active" defaultChecked={item?.active ?? true} style={{ width: 'auto' }} /> Ativo
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
          <input type="checkbox" name="store_published" defaultChecked={item?.store_published ?? false} style={{ width: 'auto' }} /> Publicar na loja
        </label>
      </div>
      <div><button className="btn" type="submit">Salvar produto</button></div>
    </form>
  );
}
