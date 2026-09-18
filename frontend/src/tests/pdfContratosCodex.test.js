import { describe, it, expect } from 'vitest';
import { validateRenderableReport, measureReportLayout, choosePageEnd } from '../laudo/exportarLaudoPdf.js';
import { labelModalidade } from '../laudo/laudoUtils.js';
describe('higiene sobre prosa sem alterar evidência literal',()=>{
 it('preserva nome de arquivo com sublinhado e pontos',()=>{
  const el=document.createElement('div');el.dataset.sourceFilename='CONTRATO_CCB..pdf';el.textContent='Arquivo: CONTRATO_CCB..pdf. Contrato examinado: CONTRATO_CCB..pdf';
  expect(()=>validateRenderableReport(el)).not.toThrow();
 });
 it('continua recusando enum fora do nome original',()=>{
  const el=document.createElement('div');el.dataset.sourceFilename='CONTRATO_CCB..pdf';el.textContent='Arquivo: CONTRATO_CCB..pdf. Modalidade: CDC_COM_GARANTIA';
  expect(()=>validateRenderableReport(el)).toThrow('enum interno');
 });
 it('continua recusando pontuação duplicada fora do nome original',()=>{
  const el=document.createElement('div');el.dataset.sourceFilename='CONTRATO_CCB..pdf';el.textContent='Arquivo: CONTRATO_CCB..pdf. Campo ausente..';
  expect(()=>validateRenderableReport(el)).toThrow('ponto duplicado');
 });
 it('exibe modalidades novas em linguagem legível',()=>{
  for (const code of ['COMPRA_CARTAO','CDC_COM_GARANTIA','SAQUE_CARTAO_CONSIGNADO','CREDITO_PESSOA_JURIDICA']) expect(labelModalidade(code)).not.toContain('_');
 });
});

describe('paginação na geometria capturada',()=>{
 it('mede posições relativas ao relatório clonado, mesmo com deslocamento de tela',()=>{
  const root=document.createElement('div');root.innerHTML='<div class="summary-page"><div class="summary-gravity-row"></div></div>';
  root.getBoundingClientRect=()=>({top:500,width:794});root.querySelector('.summary-page').getBoundingClientRect=()=>({top:2500,bottom:3900});root.querySelector('.summary-gravity-row').getBoundingClientRect=()=>({top:3550,bottom:3650});
  const x=measureReportLayout(root);expect(x.width).toBe(794);expect(x.summaries).toEqual([{start:2000,end:3158}]);expect(x.avoid).toContainEqual({start:3050,end:3150});
 });
 it('mantém caixas geográficas, aviso legal, parágrafos e linhas de tabela inteiros',()=>{
  const root=document.createElement('div');root.innerHTML='<div class="summary-geo-box"></div><div class="legal"></div><p>Nota</p><table><tbody><tr><td>Dado</td></tr></tbody></table>';
  root.getBoundingClientRect=()=>({top:0,width:794});
  for(const [index,node] of Array.from(root.querySelectorAll('.summary-geo-box,.legal,p,tr')).entries())node.getBoundingClientRect=()=>({top:index*100,bottom:index*100+80});
  expect(measureReportLayout(root).avoid).toEqual([{start:0,end:80},{start:100,end:180},{start:200,end:280},{start:300,end:380}]);
 });
 it('quebra antes de uma linha atravessada e mantém progresso numa linha extensa',()=>{
  expect(choosePageEnd(2000,3100,[{start:3050,end:3150}])).toBe(3050);
  expect(choosePageEnd(2000,3100,[{start:2900,end:3101}])).toBe(3100);
  expect(choosePageEnd(3050,4150,[{start:3050,end:5000}])).toBe(4150);
 });
});
