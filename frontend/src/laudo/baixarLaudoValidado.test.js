import {Blob as NodeBlob} from 'node:buffer';
import {it,expect,vi,afterAll} from 'vitest';
vi.stubGlobal('Blob',NodeBlob);
vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:teste-validado'),revokeObjectURL:vi.fn()});
afterAll(()=>vi.unstubAllGlobals());
import {baixarLaudoValidado} from './baixarLaudoValidado.js';
it('usa o PDF do servidor e não o conteúdo do DOM',async()=>{
 const api={get:vi.fn(async()=>({data:new Blob(['%PDF-1.7\nvalidated'],{type:'application/pdf'})}))};
 const p=await baixarLaudoValidado(api,'id-1');expect(api.get).toHaveBeenCalledWith('/analyses/id-1/pdf',{responseType:'blob'});expect(p.url).toMatch(/^blob:/);URL.revokeObjectURL(p.url);
});
it('propaga bloqueio 409 e seus detalhes sem criar PDF',async()=>{
 const coerencia=[{regra:'trilha',bloqueante:true}];
 const api={get:vi.fn(async()=>{throw {response:{status:409,data:new Blob([JSON.stringify({error:'Inconsistência',coerencia})])}}})};
 await expect(baixarLaudoValidado(api,'id')).rejects.toMatchObject({message:'Inconsistência',coerencia});
});
it('rejeita resposta JSON/HTML ou vazia enviada como blob',async()=>{
 await expect(baixarLaudoValidado({get:async()=>({data:new Blob(['<html>Erro</html>'])})},'id')).rejects.toThrow(/PDF válido/);
});
