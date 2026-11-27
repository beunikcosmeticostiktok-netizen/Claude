/**
 * Recebe os pedidos de orçamento do site e grava em uma planilha do Google.
 *
 * COMO USAR
 * 1. Crie uma planilha em sheets.google.com (ex.: "Leads Century Shalom").
 * 2. Menu Extensões > Apps Script. Apague o código e cole este arquivo.
 * 3. Clique em Implantar > Nova implantação > tipo "App da Web".
 *    - Executar como: Eu
 *    - Quem tem acesso: Qualquer pessoa
 * 4. Autorize e copie a URL gerada (termina em /exec).
 * 5. No index.html, cole essa URL em LEADS_ENDPOINT.
 *
 * Opcional: coloque um e-mail em AVISAR_EMAIL para receber um aviso a cada pedido.
 */
const ABA = 'Leads';
const AVISAR_EMAIL = '';   // ex.: 'comercial@suaempresa.com.br'

// evita que textos começando com = + - @ virem fórmulas na planilha
const limpa = v => { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; };

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ABA) || ss.insertSheet(ABA);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Data', 'Nome', 'Empresa', 'WhatsApp', 'E-mail', 'Preciso de', 'Volume mensal', 'Detalhes', 'Página']);
  }
  sh.appendRow([new Date(d.data), limpa(d.nome), limpa(d.empresa), limpa(d.tel), limpa(d.email),
                limpa(d.tipo), limpa(d.vol), limpa(d.msg), limpa(d.pagina)]);
  if (AVISAR_EMAIL) {
    MailApp.sendEmail(AVISAR_EMAIL, 'Novo pedido de orçamento — ' + d.empresa,
      'Nome: ' + d.nome + '\nEmpresa: ' + d.empresa + '\nWhatsApp: ' + d.tel + '\nPreciso de: ' + d.tipo +
      '\nVolume: ' + (d.vol || '-') + '\nDetalhes: ' + (d.msg || '-'));
  }
  return ContentService.createTextOutput('ok');
}
