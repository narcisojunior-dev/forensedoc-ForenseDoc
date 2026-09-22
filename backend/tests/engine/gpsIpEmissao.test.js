import { describe, it, expect } from 'vitest';
import { recomputeDerived } from '../../src/services/analysisRecompute.js';
import { validarEmissao, exigirEmissaoCoerente } from '../../src/engine/validarEmissao.js';
const make = (gps = {lat:-3.4340189,lon:-60.4593232}) => {
 const ip='2804:18:6881:4f33:e868:6941:39ee:81fc';
 const e={trilha_eventos:{eventos:[{nome:'Aceite',ip,lat:gps?.lat,lon:gps?.lon,data_hora:'25/06/2025 10:45:03'}]}};
 return recomputeDerived({text:JSON.stringify(e),home:{estado_confronto:'INDISPONIVEL_NAO_INFORMADO'},contractGeo:gps,ipAnalysis:[{endereco:ip,geo:{lat:-3.29972,lon:-60.62056,source:'ipapi.co',queryId:'consulta-teste',queriedAt:'2026-09-18T19:00:00Z',granularity:'estimativa de rede'}}]},e);
};
describe('confronto medido com papel de IP indeterminado',()=>{
 it('mantém 23,3 km sem inventar residência, atribuição ou localização histórica',()=>{
  const r=make(),par=r.confronto_enderecos.pares.find(p=>p.id==='gps-x-ip');
  expect(par.km).toBeCloseTo(23.30954943753904,9);
  expect(par.metodo.para.rotulo).toContain(r.ipAnalysis[0].endereco);
  expect(par.metodo.para.consultadoEm).toBe('2026-09-18T19:00:00Z');
  expect(par.metodo.para.evidencias[0]).toContain('evento-1');
  expect(par.memoria_calculo).toContain('não comprova localização na data do ato');
  expect(r.contractGeo.distance).toBeNull();
  expect(r.ipAnalysis[0].role).toBe('unknown');
  expect(r.ipAnalysis[0].divergenciaAssinatura.rotulo).toBe('DISTÂNCIA DESCRITIVA');
  expect(r.sumarioIrregularidades.synthesis).toMatch(/foram comparados/);
  expect(r.sumarioIrregularidades.synthesis).toMatch(/não foi determinado nesta análise/);
  expect(r.sumarioIrregularidades.synthesis).not.toMatch(/não foi concluído|convergência é favorável/);
  expect(()=>exigirEmissaoCoerente(r)).not.toThrow();
 });
 it.each([23.3,0])('bloqueia negação de confronto medido inclusive zero (%s)',km=>{
  const r=make();r.confronto_enderecos.pares.find(p=>p.id==='gps-x-ip').km=km;
  r.sumarioIrregularidades.synthesis='O confronto entre GPS e IP de acesso não foi concluído porque a referência residencial não está disponível.';
  expect(validarEmissao(r).find(v=>v.regra==='gps-ip-calculado-x-negado')?.bloqueante).toBe(true);
 });
 it('sem GPS registra indisponibilidade, nunca distância zero',()=>{
  const r=make(null);expect(r.confronto_enderecos.pares.find(p=>p.id==='gps-x-ip').km).toBeNull();
  expect(r.ipAnalysis[0].distanceToSignature).toBeNull();
  expect(validarEmissao(r).some(v=>v.regra==='gps-ip-calculado-x-negado')).toBe(false);
 });
});
it('sumário usa o mesmo checklist do corpo e bloqueia contagem persistida divergente',()=>{
 const r=make();
 expect(r.sumarioIrregularidades.custodyChecklist).toEqual({present:r.cadeiaCustodia.presentes,total:r.cadeiaCustodia.total});
 expect(r.sumarioIrregularidades.allFindings.find(f=>f.key==='CUS1').text).toContain(`${r.cadeiaCustodia.presentes} de ${r.cadeiaCustodia.total}`);
 r.cadeiaCustodia.presentes=999;
 expect(validarEmissao(r).find(v=>v.regra==='checklist-divergente')?.bloqueante).toBe(true);
});
