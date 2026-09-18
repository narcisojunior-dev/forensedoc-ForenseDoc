import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { heuristicExtractionFromText } from '../../src/engine/extraction.js';
import { buildIrregularitySummary } from '../../src/engine/irregularitySummary.js';
import { exigirEmissaoCoerente, validarEmissao } from '../../src/engine/validarEmissao.js';
import { generateJudicialQuesitos } from '../../src/reports/quesitosTemplate.js';
const {texto}=JSON.parse(fs.readFileSync(new URL('../corpus/casos/c6-consig-clt-dossie.json',import.meta.url),'utf8'));
const snapshot = e => ({text:JSON.stringify(e),sumarioIrregularidades:buildIrregularitySummary({extracted:e})});
describe('emissão ancorada em evidências',()=>{
 it('mantém os fatos do dossiê e separa cálculo previsto de desembolso',()=>{
  const e=heuristicExtractionFromText(texto),s=snapshot(e);
  expect(e.contrato.numero).toBe('1234567890'); expect(e.contrato.valor_liberado).toBe('R$ 1.779,15');
  expect(e.contrato.valor_total_emprestimo).toBe('R$ 2.033,86');expect(e.contrato.numero_parcelas).toBe('6');
  expect(e.trilha_eventos.eventos).toHaveLength(6);expect(e.trilha_eventos.eventos.filter(e=>e.ip)).toHaveLength(4);
  expect(e.trilha_eventos.eventos.filter(e=>Number.isFinite(e.lat)&&Number.isFinite(e.lon))).toHaveLength(3);
  expect(e.afericao_matematica.cet_implicito_mensal_numero).toBeCloseTo(.07589421822687814,9);
  expect(e.afericao_matematica.conclusao).toMatch(/hipótese de liberação na data de emissão/);
  expect(e.contrato.prazo_total_declarado.ressalva).toContain('o que acontecer por último');
  expect(e.seguro_prestamista.vigencia.inicio_declarado).toBeNull();
  expect(e.seguro_prestamista.forma_pagamento_instrumento).toMatchObject({pagina:3,valor:'À Vista'});
  expect(e.seguro_prestamista.forma_pagamento).toBe('Financiado');
  expect(e.seguro_prestamista.achados.find(a=>a.codigo==='SEG9').texto).toMatch(/não prova cobrança duplicada/);
  const textos=[...e.achados_irregularidade.map(a=>a.texto),...generateJudicialQuesitos({extracted:e,achados:e.achados_irregularidade}).map(q=>q.quesito+' '+q.finalidade)].join('\n');
  expect(textos).not.toMatch(/121 dias|tempo incompatível com a leitura|expressa impugnação.*formulada|cadastro feito por terceiro/);
  expect(s.sumarioIrregularidades.diligences.find(d=>d.key==='auth-code').text).toContain('pág. 2');
  expect(()=>exigirEmissaoCoerente(s)).not.toThrow();
 });
 it('bloqueia contradição atual apesar de flag desativada e validação antiga vazia; libera após corrigir',()=>{
  const e={trilha_eventos:{eventos:[{nome:'Aceite',ip:'1.1.1.1'}]}};
  const s={text:JSON.stringify(e),coerencia:[],coerencia_bloqueante:false,sumarioIrregularidades:{synthesis:'ausência integral de trilha de rede'}};
  process.env.COERENCIA_BLOQUEANTE='false';
  expect(()=>exigirEmissaoCoerente(s)).toThrow(/Emissão suspensa/);
  expect(validarEmissao(s).find(v=>v.regra==='trilha-presente-x-negada').bloqueante).toBe(true);
  s.sumarioIrregularidades.synthesis='Um evento de aceite registrado.';
  expect(()=>exigirEmissaoCoerente(s)).not.toThrow();delete process.env.COERENCIA_BLOQUEANTE;
 });
 it('aceita zero medido entre pontos válidos, mas rejeita distância calculada de nulos',()=>{
  const s={text:'{}',home:{geo:{lat:0,lon:0}},contractGeo:{lat:0,lon:0,distance:0}};
  expect(()=>exigirEmissaoCoerente(s)).not.toThrow();s.home.geo.lat=null;
  expect(()=>exigirEmissaoCoerente(s)).toThrow();
 });
 it('coincidência de datas e taxa extrema são alertas, sem veto',()=>{
  const s={text:JSON.stringify({contrato:{data_contrato:'01/01/2025'},metadados_processuais:{data_juntada:'01/01/2025'},afericao_matematica:{cet_implicito_mensal_numero:.2}})};
  expect(validarEmissao(s)).toHaveLength(2);expect(validarEmissao(s).every(v=>!v.bloqueante)).toBe(true);expect(()=>exigirEmissaoCoerente(s)).not.toThrow();
 });
 it.each(['a'.repeat(40),'a'.repeat(128),'a'.repeat(64)])('hash não comparável não recebe veredito favorável (%s)',hash=>{
  const s=buildIrregularitySummary({extracted:{assinatura:{hash_documento_assinado:hash}},hashes:{}});
  expect(s.favorable.some(f=>f.key==='hash-ok')).toBe(false);
 });
 it('SHA256 igual é comparável; diferente é alerta',()=>{
  const a='a'.repeat(64), b='b'.repeat(64);const args={extracted:{assinatura:{hash_documento_assinado:a}},hashes:{sha256:a}};
  expect(buildIrregularitySummary(args).favorable.some(f=>f.key==='hash-ok')).toBe(true);
  args.hashes.sha256=b;expect(buildIrregularitySummary(args).allFindings.some(f=>f.key==='hash-mismatch')).toBe(true);
 });
 it('preserva duas ocorrências do mesmo código e ressalva longa; elimina duplicata idêntica',()=>{
  const a={codigo:'T1',gravidade:'ALTA',titulo:'Documento A',texto:'Texto. '.repeat(130)+'Somente sob premissa explícita.'};
  const b={...a,titulo:'Documento B'};const s=buildIrregularitySummary({extracted:{achados_irregularidade:[a,b,a]}});
  expect(s.allFindings.filter(f=>f.key==='T1')).toHaveLength(2);expect(s.findings.filter(f=>f.key==='T1').every(f=>f.text.endsWith('Somente sob premissa explícita.'))).toBe(true);
 });
 it.each([null,'',' ','não disponível',false,91])('não transforma coordenadas ausentes/fora da faixa em ponto (%s)',lat=>{
  const s=buildIrregularitySummary({extracted:{trilha_eventos:{eventos:[{lat,lon:null}]}}});
  expect(s.geo.insumos.eventos_com_coordenada).toBe(0);
 });
 it('não emite uma extração inválida ou uma afirmação de remoção sem evidência',()=>{
  expect(()=>exigirEmissaoCoerente({text:'{'})).toThrow();
  expect(()=>exigirEmissaoCoerente(snapshot({achados_irregularidade:[{codigo:'BIO2',texto:'fotografia com metadados removidos'}]}))).toThrow();
 });
});
