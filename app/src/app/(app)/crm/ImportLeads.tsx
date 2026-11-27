'use client';
import { useState } from 'react';
import { FIELDS, MODEL_CSV, buildRows, guessMapping, validateRow, type FieldKey, type LeadRow, type Mapping } from '@/lib/import-leads';
import { importLeadsChunk, type ChunkResult } from './actions';

const MAX_ROWS = 2000;
const CHUNK = 25;

export function ImportLeads() {
  const [fileName, setFileName] = useState('');
  const [data, setData] = useState<unknown[][]>([]);
  const [map, setMap] = useState<Mapping | null>(null);
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ChunkResult | null>(null);

  const rows: LeadRow[] = map ? buildRows(data, map) : [];
  const checked = rows.map((r) => ({ r, err: validateRow(r) }));
  const good = checked.filter((c) => !c.err).map((c) => c.r);
  const bad = checked.filter((c) => c.err);

  async function onFile(f: File | undefined) {
    setMsg(''); setResult(null); setData([]); setMap(null);
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (f.size > 5 * 1024 * 1024) return setMsg('Arquivo grande demais (máximo 5 MB).');
    if (ext === 'pdf') return setMsg('Lista em PDF não tem colunas de verdade e a leitura automática erra nomes e telefones. Abra o PDF, copie a tabela para o Excel (ou Google Planilhas) e salve como .xlsx ou .csv.');
    if (ext === 'xls') return setMsg('Arquivo .xls antigo: abra no Excel e use “Salvar como” .xlsx ou .csv.');
    try {
      let table: unknown[][];
      if (ext === 'xlsx') {
        const { readSheet } = await import('read-excel-file/browser');
        table = (await readSheet(f)) as unknown[][];
      } else if (ext === 'csv' || ext === 'txt') {
        const Papa = (await import('papaparse')).default;
        table = Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data;
      } else return setMsg('Use um arquivo .xlsx ou .csv.');
      if (table.length < 2) return setMsg('A planilha precisa ter a linha de títulos e pelo menos um contato.');
      if (table.length - 1 > MAX_ROWS) return setMsg(`Máximo de ${MAX_ROWS} contatos por importação. Divida a planilha.`);
      setFileName(f.name); setData(table); setMap(guessMapping(table[0]));
    } catch { setMsg('Não consegui ler este arquivo. Confira se é uma planilha válida (.xlsx ou .csv).'); }
  }

  async function run() {
    setResult(null);
    const total: ChunkResult = { created: 0, attached: 0, errors: [] };
    setProgress({ done: 0, total: good.length });
    for (let i = 0; i < good.length; i += CHUNK) {
      const r = await importLeadsChunk(good.slice(i, i + CHUNK), fileName);
      total.created += r.created; total.attached += r.attached; total.errors.push(...r.errors);
      setProgress({ done: Math.min(i + CHUNK, good.length), total: good.length });
    }
    setProgress(null); setResult(total); setData([]); setMap(null);
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + MODEL_CSV], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'modelo-contatos.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const headers = (data[0] ?? []).map((h) => String(h ?? ''));

  return (
    <div className="stack">
      <p className="muted small">Envie uma planilha <b>Excel (.xlsx)</b> ou <b>CSV</b> com a lista de contatos. O arquivo é lido no seu navegador; você confere tudo antes de gravar. Cada linha vira um contato e uma oportunidade, sem duplicar clientes que já existem.</p>
      <div className="inline">
        <input type="file" accept=".xlsx,.csv,.txt,.xls,.pdf" onChange={(e) => onFile(e.target.files?.[0])} style={{ maxWidth: 360 }} />
        <button className="btn line sm" type="button" onClick={download}>Baixar planilha-modelo</button>
      </div>
      {msg && <div className="alert warn">{msg}</div>}

      {map && (
        <>
          <b className="small">1. Confira o que cada coluna significa</b>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            {FIELDS.map(([k, label]) => (
              <label key={k}>{label}{(k === 'name') && ' *'}
                <select value={map[k]} onChange={(e) => setMap({ ...map, [k as FieldKey]: Number(e.target.value) })}>
                  <option value={-1}>— não importar —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                </select></label>
            ))}
          </div>
          <b className="small">2. Pré-visualização (primeiras linhas)</b>
          <div className="scroll"><table className="table"><thead><tr><th>Linha</th><th>Nome</th><th>Empresa</th><th>Contato</th><th>Situação</th></tr></thead><tbody>
            {checked.slice(0, 8).map(({ r, err }) => (
              <tr key={r.n}><td>{r.n}</td><td>{r.name || '—'}</td><td>{r.company || '—'}</td><td className="small">{[r.phone, r.email].filter(Boolean).join(' · ') || '—'}</td>
                <td>{err ? <span className="badge off">{err}</span> : <span className="badge on">ok</span>}</td></tr>))}
          </tbody></table></div>
          <p className="small"><b>{good.length}</b> contato(s) prontos para importar{bad.length > 0 && <> · <span className="err"><b>{bad.length}</b> com problema (serão ignorados): {bad.slice(0, 5).map((c) => `linha ${c.r.n} (${c.err})`).join(', ')}{bad.length > 5 ? '…' : ''}</span></>}.</p>
          <div className="inline">
            <button className="btn" type="button" disabled={!good.length || !!progress} onClick={run}>{progress ? `Importando… ${progress.done}/${progress.total}` : `Importar ${good.length} contato(s)`}</button>
            <button className="btn line" type="button" disabled={!!progress} onClick={() => { setData([]); setMap(null); }}>Cancelar</button>
          </div>
        </>
      )}
      {result && (
        <div className={`alert ${result.errors.length ? 'warn' : 'ok'}`}>
          Importação concluída: <b>{result.created}</b> novo(s) contato(s) com oportunidade criada · <b>{result.attached}</b> ligado(s) a clientes que já existiam.
          {result.errors.length > 0 && <> <b>{result.errors.length}</b> linha(s) não entraram: {result.errors.slice(0, 10).map((e) => `linha ${e.n} (${e.msg})`).join(', ')}{result.errors.length > 10 ? '…' : ''}.</>}
        </div>
      )}
    </div>
  );
}
