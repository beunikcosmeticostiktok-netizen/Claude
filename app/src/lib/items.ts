export const ITEM_TYPES = [
  ['produto_acabado', 'Produto acabado'], ['materia_prima', 'Matéria-prima'], ['componente', 'Componente'],
  ['embalagem_auxiliar', 'Embalagem auxiliar'], ['servico', 'Serviço'],
] as const;
export const itemTypeLabel = (t: string) => ITEM_TYPES.find(([k]) => k === t)?.[1] ?? t;
export type Tier = { id: number; ord: number; qty_min: number; qty_max: number | null; label: string };

export const ITEM_ERRORS: Record<string, string> = {
  dados: 'Informe o código (SKU) e o nome.', numero: 'Confira os números de peso, capacidade e dimensões.',
  preco: 'Confira os preços (use números, ex.: 3,20).', sku: 'Já existe um produto com este código.',
  falha: 'Não foi possível salvar. Tente novamente.',
};
