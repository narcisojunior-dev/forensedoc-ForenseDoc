/** Campos do instrumento: preserva rótulo, linha, coluna e papel do credor.
 * Referências a outra dívida, dados bancários e exemplos no clausulado não
 * identificam a operação atual. Nenhum valor particular de cliente é embutido.
 */
const money = '(?:R\\$\\s*)?([0-9]+(?:\\.[0-9]{3})*,[0-9]{2})(?![0-9])';
const cnpj = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const id = '[A-Z0-9][A-Z0-9./-]{4,49}';
const clean = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const validId = s => (s?.match(/\d/g)||[]).length >= 4 && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(s) && !/visualizar|https|cliente|^\d{2}\/\d{2}\/\d{4}$/i.test(s);

/** Read a filled field on the label line or directly below in its column.
 * A value must start the cell; searching ahead for any number crosses fields.
 */
export function readLabeledCell(text, label, valuePattern, {rows=3}={}) {
  const lines=String(text).replace(/\f/g,'').split('\n');
  const valueRe=new RegExp('^\\s*[:;]?\\s*(?:\\([0-9.,]+%\\)\\s*)?'+valuePattern,'i');
  for(let i=0;i<lines.length;i++) {
    const line=lines[i], m=label.exec(line);
    if(!m) continue;
    const tail=line.slice(m.index+m[0].trimEnd().length);
    const inline=valueRe.exec(tail);
    if(inline && !/^\s*[-–]\s*[A-Za-z]/.test(tail.slice(inline[0].length))) return {value:inline[1], literal:line.trim(), line:i+1};
    // Long text in the same cell is prose, not an empty form field.
    if(tail.trim() && !/^[:\s]*(?:\([^)]*\))?(?:\s{2,}|$)/.test(tail)) continue;
    const nextColumn=tail.search(/\s{2,}\S|\s+\d+(?:\.\d+)*\s*[-–]\s*[A-Za-z]/);
    const end=nextColumn>=0 ? m.index+m[0].trimEnd().length+nextColumn+tail.slice(nextColumn).search(/\S/) : Infinity;
    // Include a numeric item prefix before the label in the column geometry.
    const prefix=line.slice(0,m.index);
    const gaps=[...prefix.matchAll(/\s{2,}/g)];
    const gap=gaps.at(-1);
    const start=gap ? gap.index+gap[0].length : 0;
    for(let n=1;n<=rows && i+n<lines.length;n++) {
      const below=lines[i+n]; if(below.includes('\f'))break;
      const cell=below.slice(Math.max(0,start-2),end===Infinity?undefined:end);
      const found=valueRe.exec(cell);
      if(found) return {value:found[1],literal:line.trim()+' / '+below.trim(),line:i+1};
      if(cell.trim() && !/^(?:\([^)]*\)|(?:dias|meses|parcela|emprestimo)\s*:?\s*)$/i.test(clean(cell.trim())))break;
    }
  }
  return null;
}

export function extractContractContext(text) {
  const t=String(text), flat=t.replace(/\s+/g,' '), out={}, evidence={};
  const put=(key,cell,format=x=>x)=>{if(cell){out[key]=format(cell.value);evidence[key]={trecho:cell.literal,linha:cell.line};}};
  // Prefer the number attached to the instrument's own title.
  const patterns=[
    new RegExp('C[eé]dula\\s+de\\s+Cr[eé]dito\\s+Banc[aá]rio(?:\\s+de\\s+Renegocia[cç][aã]o\\s+de\\s+Empr[eé]stimo\\s+Consignado)?\\s*(?:[-–]\\s*CCB\\s*[-–]?)?\\s*(?:N[º°o.r]*\\s*[:.]?\\s*)('+id+')','ig'),
    new RegExp('(?:N[º°o.]*\\s+(?:da\\s+)?(?:CCB|C[eé]dula)|C[eé]dula\\s+N[º°o.]*|CCB\\s*N[º°o.:]*)\\s*[:.]?\\s*('+id+')','ig'),
    new RegExp('C[eé]dula\\s+de\\s+Cr[eé]dito\\s+Banc[aá]rio\\s*[-–]\\s*Proposta\\s+('+id+')','ig'),
  ];
  for(const re of patterns) {const matches=[...flat.matchAll(re)];const m=matches.find(m=>validId(m[1]));if(m){out.contratoNumero=m[1];evidence.contratoNumero={trecho:m[0]};break;}}
  if(!out.contratoNumero){put('contratoNumero',readLabeledCell(t,/(?:Contrato\s+n[º°o.:]*|CCB\s*n[º°o.:]*)\s*:?/i,'('+id+')'));if(!validId(out.contratoNumero))delete out.contratoNumero;}
  if(!out.contratoNumero && /Condi[cç][oõ]es\s+Gerais\s+do\s+Limite\s+de\s+Cr[eé]dito/i.test(t)) {
    const m=t.slice(0,700).match(/N[º°]\s*(\d{5,30})/);if(m)out.contratoNumero=m[1];
  }
  // Explicit creditor section. The first CNPJ anywhere may belong to the
  // borrower, correspondent or original loan; it is deliberately not used.
  const role=/(?:^|\n)[^\n]{0,45}(?:INSTITUI[ÇC][ÃA]O\s+CREDORA|(?:DADOS\s+DA\s+)?INSTITUI[ÇC][ÃA]O\s+FINANCEIRA\s*\(CREDOR\)|(?:QUADRO\s+)?[IVX\d]+\s*[-–.]\s*CREDOR(?:\s+ORIGIN[ÁA]RIO)?|Institui[çc][ãa]o\s+Financeira:)/ig;
  const bankName=/(BANCO\s+[A-ZÀ-Ú0-9() .]+?(?:\bS\.?\s*A\.?\b|\bS\/A\b)|QI\s+SOCIEDADE\s+DE\s+CR[ÉE]DITO\s+DIRETO\s+S\.?A\.?|FACTA\s+FINANCEIRA[^\n,]{0,70})/i;
  for(const m of t.matchAll(role)) {
    const block=t.slice(m.index,m.index+m[0].length+650), bank=block.match(bankName);
    if(!bank)continue;
    out.banco=bank[1].replace(/\s+/g,' ').trim();
    const institution=block.slice(bank.index).match(cnpj);
    if(institution)out.cnpjInstituicao=institution[0].replace(/\D/g,'');
    evidence.banco={trecho:block.slice(bank.index,bank.index+220).trim()};break;
  }
  if(!out.banco) {
    const promise=flat.match(/(?:pagarei|pagaremos)[\s\S]{0,220}?(?:ao|a[oà])\s+(Banco\s+[^,]{3,80}?S\.?\s*A\.?|Ita[úu]\s+Unibanco\s+S\.?A\.?)[,\s]+CNPJ(?:\/MF)?\s*(?:n[ºo°.]*)?\s*([\d./-]{18})/i);
    if(promise){out.banco=promise[1];out.cnpjInstituicao=promise[2].replace(/\D/g,'');}
  }
  if (!out.cnpjInstituicao) {
    const credor = flat.match(/(?:ao|em\s+favor\s+do)\s+(Banco\s+[A-ZÀ-Ú0-9() .]+?\bS\.?\s*A\.?)[,\s][\s\S]{0,350}?CNPJ(?:\/MF)?\)?(?:\s*(?:sob|o|n[ºo°.]|nr[.]?))*\s*([\d./-]{18})/i);
    if (credor) {out.banco=credor[1];out.cnpjInstituicao=credor[2].replace(/\D/g,'');}
  }
  // A field or title establishes the product; a passing RMC mention doesn't.
  const title=t.split('\n').filter(l=>/C[ée]dula|Empr[ée]stimo|Consigna|Saque|Cart[ãa]o|Contrata[cç][aã]o|Ades[ãa]o/i.test(l)).slice(0,7).join(' ');
  if(/CONTRATA[ÇC][ÃA]O\s+DE\s+SAQUE/i.test(title))out.modalidade='SAQUE_CARTAO_CONSIGNADO';
  else if(/(?:Proposta\s+de\s+Ades[ãa]o|Cart[ãa]o\s+Consignado\s+de\s+Benef[ií]cio)/i.test(title)&&/Facta\s+Financeira/i.test(flat))out.modalidade='RMC';
  else if (/(?:^|\n)\s*(?:Termo\s+de\s+(?:Consentimento\s+Esclarecido|Ades[ãa]o)|Proposta\s+de\s+Ades[ãa]o)[^\n]{0,100}Cart[ãa]o\s+(?:de\s+Cr[eé]dito\s+)?Consignado/im.test(t)) out.modalidade = /reserva(?:r[áa])?\s+de\s+margem\s+consign[áa]vel|\bRMC\b|cart[ãa]o\s+consignado\s+de\s+benef[ií]cio/i.test(flat) ? 'RMC' : 'RCC';
  else if(/Empr[eé]stimo|Cr[eé]dito\s+Consignado/i.test(title) || /Modalidade:\s*Cr[eé]dito\s+(?:Pessoal\s+)?Consignado/i.test(flat))out.modalidade='Emprestimo Consignado';
  const head = t.slice(0,1600);
  if (/Reten[^\n]*INSS[^\n]*Refi[a-z]{0,4}ciament/i.test(head) || /C[eé]dula[^\n]*\n\s*Refinanciamento/i.test(head)) out.tipoOperacao="REFINANCIAMENTO";
  const finalidade=head.match(/FINALIDADE\s+DA\s+OPERA[ÇC][ÃA]O:[^\n]{0,160}\([xX]\)\s*(Portabilidade|Refinanciamento|Contrato novo)/i);
  if(finalidade)out.tipoOperacao=clean(finalidade[1]).toUpperCase().replace('CONTRATO NOVO','NOVO');
  const moneyFields={
    valorLiberadoSolicitado:/Valor\s+(?:l[ií]quido\s+(?:liberado|do\s+cr[eé]dito)|liberado\s+ao\s+cliente|entregue)\s*:?/i,
    valorTotalEmprestimo:/(?:Valor\s+(?:principal\s+do\s+cr[eé]dito|do\s+Empr[eé]stimo(?:\s*\(financiado\))?|Financiado)|Total\s+financiado)\s*:?/i,
    valorParcela:/Valor\s+(?:da(?:\(s\))?\s+Parcela(?:\(s\))?|das\s+parcelas|de\s+cada\s+parcela(?:\s+mensal)?)(?:\s*\([A-Z]+\))?\s*:?/i,
    valorTotalParcelas:/(?:Valor\s+Total\s+a\s+Pagar|Somat[oó]rio\s+das\s+Parcelas|Total\s+a\s+pagar)\s*:?/i,
    iofTotal:/(?:Valor\s+do\s+IOF|Valor\s+IOF|IOF\s*\(imposto\))\s*:?/i,
  };
  for(const [key,label] of Object.entries(moneyFields))put(key,readLabeledCell(t,label,money),v=>'R$ '+v);
  put('numeroParcelas',readLabeledCell(t,/(?:Quantidade\s+(?:de\s+)?Parcelas|N[uú]mero\s+de\s+parcelas(?:\s+mensais)?|Qtd\.\s*De\s+Parcelas)(?:\s*\([A-Z]+\))?\s*:?/i,'(\\d{1,3})(?![\\d.,])'));
  put('taxaJurosMensal',readLabeledCell(t,/(?:Taxa\s+de\s+Juros\s+(?:Efetiva\s+)?Mensal|Juro\s+mensal\s+da\s+opera[cç][aã]o)\s*:?/i,'([\\d.,]+)\\s*%'),v=>v+'%');
  put('taxaJurosAnual',readLabeledCell(t,/(?:Taxa\s+de\s+Juros\s+(?:Efetiva\s+)?Anual(?:\s*\(365\s+dias\))?|Juro\s+anual\s+da\s+opera[cç][aã]o)\s*:?/i,'([\\d.,]+)\\s*%'),v=>v+'%');
  // Paired rates share a row; exclude penalty and arrears rates by the label.
  const rates=flat.match(/(?:Juros\s+Remunerat[oó]rios\s+Pr[eé]-?Fixado|Taxa\s+de\s+juros\s+Prefixada\s+mensal\s*\(30\s+dias\)\s+e\s+anual\s*\(360\s+dias\))\s*:?\s*([\d.,]+)\s*%\s*(?:ao\s+m[eê]s|a\.m\.?)\s*\/?\s*([\d.,]+)\s*%/i);
  if(rates){out.taxaJurosMensal=rates[1]+'%';out.taxaJurosAnual=rates[2]+'%';}
  out.evidenciasContexto=evidence;
  return out;
}

const MONTHS=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const numericDate=v=>v?.replace(/\./g,'/');
function writtenDate(match){if(!match)return null;const month=MONTHS.indexOf(clean(match[2]).toLowerCase());return month<0?null:match[1].padStart(2,'0')+'/'+String(month+1).padStart(2,'0')+'/'+match[3];}

/** Complementos de campos com rótulos compostos e pares de coluna conhecidos. */
export function extractExtendedContractFields(text) {
  const t=String(text), flat=t.replace(/\s+/g,' '), out={};
  const cell=(label,pattern=money,opts)=>readLabeledCell(t,label,pattern,opts)?.value;
  const cash=(key,label)=>{const v=cell(label);if(v)out[key]='R$ '+v;};
  cash('valorTotalEmprestimo',/(?:Valor\s+total\s+da\s+opera[cç][aã]o|Valor\s+novo\s+Contrato)\s*:?/i);
  cash('valorLiberadoSolicitado',/(?:Livre\s+Utiliza[cç][aã]o|Valor\s+l[ií]quido\s+a\s+liberar)\s*:?/i);
  cash('valorParcela',/Valor\s+da\s+pre{1,2}sta[cç][aã]o(?:\s*\(R\$\))?\s*:?/i);
  const qtd=cell(/(?:Quantidade\s+de\s+presta[cç][oõ]es|N[º°o]\s+de\s+Parcelas)\s*:?/i,'(\\d{1,3})(?![\\d.,])');if(qtd)out.numeroParcelas=qtd;
  for(const [key,label] of [
    ['primeiroVencimento',/(?:Vencimento\s+(?:da\s+)?(?:1[ªº°ao]?\.?|Primeira)\s*Parcela|Data\s+da\s+primeira\s+parcela|Primeiro\s+desconto)\s*:?/i],
    ['ultimoVencimento',/(?:Vencimento\s+(?:da\s+)?[ÚU]ltima(?:\s+Parcela)?|Data\s+da\s+[úu]ltima\s+parcela|[ÚU]ltimo\s+desconto|Vencimento\s+final\s+do\s+contrato)\s*:?/i],
  ]) {const v=cell(label,'(\\d{2}[/.]\\d{2}[/.]\\d{4})');if(v)out[key]=numericDate(v);}
  const emissao=flat.match(/Data\s+e\s+local\s+de\s+emiss[ãa]o\s+desta\s+C[eé]dula\s*:\s*(\d{2}[/.]\d{2}[/.]\d{4})/i);
  const assinatura=flat.match(/assinou\s+em\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}/i);
  const extenso=t.match(/(?:Empr[eé]stimo\s+Consignado\s+Local:[^\n]{0,80}?|Data\s+e\s+hora\s*:?\s*)(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
  const ocrEmissao=flat.match(/Outros\s+dados\s+desta\s+C[eé]dula[\s\S]{0,180}?Data\s+de\s+Emiss[ãa]o\s+\d+\s+[A-ZÀ-Ú ]+?(\d{2}\/\d{2}\/\d{4})/i);
  out.dataContrato=numericDate(emissao?.[1])||assinatura?.[1]||writtenDate(extenso)||ocrEmissao?.[1]||null;
  const uuid=t.match(/CCB\s*n[º°o]\s*:[\s\S]{0,180}?\b([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\b/i);if(uuid)out.contratoNumero=uuid[1];
  for(const [key,label] of [
    ['taxaJurosMensal',/Taxa\s+de\s+juros\s+efetiva\s*\(m[eê]s\)\s*%\s*:?/i],
    ['taxaJurosAnual',/Taxa\s+de\s+juros\s+efetiva\s*\(ano\)\s*%\s*:?/i],
  ]){const v=cell(label,'([\\d.,]+)');if(v)out[key]=v+'%';}
  const itau=flat.match(/Ao\s+m[eê]s\s*\(30\s+dias\)\s*:\s*([\d.,]+)\s*%\s*[\d.]*\s*Ao\s+ano\s*\(365\s+dias\)\s*:\s*([\d.,]+)\s*%/i);
  if(itau){out.taxaJurosMensal=itau[1]+'%';out.taxaJurosAnual=itau[2]+'%';}
  const efetivas=flat.match(/Encargos\s+financeiros:\s*Taxa\s+Efetiva:\s*([\d.,]+)%\s*ao\s+m[eê]s\s*Taxa\s+Efetiva:\s*([\d.,]+)%\s*ao\s+ano/i);
  if(efetivas){out.taxaJurosMensal=efetivas[1]+'%';out.taxaJurosAnual=efetivas[2]+'%';}
  // OCR: column sequence is explicit; the first integer is a convention code.
  const conv=flat.match(/(?:C[oó]d|Cad)\.?\s*Conv[eê]nio\s+[\dE]\s*-\s*[QO]tde\.?\s*de\s*Parcelas\s+(\d{4,7})\s+(\d{1,3})\b/i);
  if(conv)out.numeroParcelas=conv[2];
  const ocrParcela=t.match(/7\s*-\s*Valor\s+da\(s\)\s+Parcela\(s\)[^\n]*\n\s*([\d.]+[.,]\d{2})\s/i);
  if(ocrParcela)out.valorParcela='R$ '+ocrParcela[1].replace(/\.(\d{2})$/,',$1');
  const ocrDates=flat.match(/11\s*-\s*Vencime\w*\s*1[2ªa]?\s*Parcela\s*12\s*-\s*Vencimento\s*[ÚU]ltima\s*Parcela\s*[A-ZÀ-Ú| ]+?\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i);
  if(ocrDates){out.primeiroVencimento=ocrDates[1];out.ultimoVencimento=ocrDates[2];}
  // Cessionária identificada explicitamente; the merchant's CNPJ isn't hers.
  const cessionaria=flat.match(/cr[eé]ditos\s+decorrentes\s+deste\s+instrumento\s+a\s+([^,]+),\s*CNPJ\s*N[º°o]\s*([\d./-]{18})/i);
  if(cessionaria){out.banco=cessionaria[1];out.cnpjInstituicao=cessionaria[2].replace(/\D/g,'');out.modalidade='COMPRA_CARTAO';cash('valorTotalEmprestimo',/Valor\s+da\s+Compra\/Presta[cç][aã]o\s+de\s+Servi[cç]os\s*:?/i);}
  const closing=t.match(/assino\(amos\)\s+esta\s+CEDULA[\s\S]{0,220}?\n\s*[A-ZÀ-Ú ]+-[A-Z]{2},\s*(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
  if(closing)out.dataContrato=writtenDate(closing);
  const electronic=t.match(/DOCUMENTO\s+ASSINADO\s+ELETRONICAMENTE[\s\S]{0,800}/i)?.[0];
  if(electronic){const v=readLabeledCell(electronic,/Data\s+e\s+hora\s*:?/i,'(\\d{2}/\\d{2}/\\d{4})',{rows:4})?.value;if(v)out.dataContrato=v;}
  const qi=flat.match(/QUADRO\s+V\s*[–-]\s*ESPECIFICA[ÇC][ÕO]ES\s+DO\s+CR[ÉE]DITO[\s\S]*?(?=7\.\s*Valor\s+da\s+Parcela)/i)?.[0];
  if(qi){const block=qi.slice(qi.search(/5\.\s*Taxa\s+de\s+Juros/i));const a=block.match(/([\d.,]+)%\s*a\.m/i),b=block.match(/([\d.,]+)%\s*a\.a/i);if(a)out.taxaJurosMensal=a[1]+'%';if(b)out.taxaJurosAnual=b[1]+'%';}
  // The pre-portability simulation is identified as such, never promoted to
  // confirmed disbursement. Its table has nine named columns in a fixed order.
  const simulation=flat.match(/Anexo\s+II[^\f]{0,170}?simula[cç][aã]o\s+pr[eé]\s*Portabilidade[\s\S]{0,800}?ano\s*%:\s*([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+(\d{1,3})\s+([\d.]+,\d{2})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i);
  if(simulation){out.valorTotalEmprestimo='R$ '+simulation[1];out.iofTotal='R$ '+simulation[2];out.valorTotalParcelas='R$ '+simulation[4];out.numeroParcelas=simulation[5];out.valorParcela='R$ '+simulation[6];out.taxaJurosMensal=simulation[7]+'%';out.taxaJurosAnual=simulation[8]+'%';out.cetAnual=simulation[9]+'%';out.condicoesNota='Condições extraídas do Anexo II, identificado como simulação pré-portabilidade. O desembolso e as condições definitivas não foram confirmados.';const schedule=[...t.matchAll(/^\s*\d{1,3}\s+(\d{2}\/\d{2}\/\d{4})\s+[\d.]+,\d{2}/gm)];if(schedule.length){out.primeiroVencimento=schedule[0][1];out.ultimoVencimento=schedule.at(-1)[1];}}
  const bv=flat.match(/C[ÉE]DULA\s+DE\s+CR[ÉE]DITO\s+BANC[ÁA]RIO\s*[–-]\s*CCB\s+(BANCO\s+VOTORANTIM\s+S\.A\.)\s*[–-]\s*CNPJ:\s*([\d./-]+)/i);
  if(bv){out.banco=bv[1];out.cnpjInstituicao=bv[2].replace(/\D/g,'');out.modalidade='CDC_COM_GARANTIA';const audit=flat.match(/Li\s+e\s+Concordo\s+CCB\s*(\d{2}\/\d{2}\/\d{4})/i);if(audit)out.dataContrato=audit[1];const rates=flat.match(/Taxa\s+de\s+Juros\s+Mensal\s*\(%\s*a\.m\):\s*([\d.,]+)%[\s\S]{0,70}?Taxa\s+de\s+Juros\s+Anual\s*\(%\s*a\.a\):\s*([\d.,]+)%/i);if(rates){out.taxaJurosMensal=rates[1]+'%';out.taxaJurosAnual=rates[2]+'%';}}
  if(/(?:^|\n)\s*ADITIVO\s+[ÀA]\s+C[ÉE]DULA/im.test(t))out.condicoesNota='O arquivo também contém aditivo. Os campos desta ficha correspondem à CCB original; as condições do aditivo devem ser confrontadas separadamente. Não há consolidação automática das duas operações.';
  const emitentePJ=t.match(/(?:^|\n)\s*1\.\s*EMITENTE:[\s\S]{0,400}?CPF\s*\/\s*CNPJ:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
  if (emitentePJ && /C[ÉE]DULA\s+DE\s+CR[ÉE]DITO\s+BANC[ÁA]RIO/i.test(t.slice(0,2200))) out.modalidade='CREDITO_PESSOA_JURIDICA';
  return Object.fromEntries(Object.entries(out).filter(([,v])=>v!==null));
}
