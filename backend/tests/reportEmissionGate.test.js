import {it,expect,vi} from 'vitest';
vi.mock('../src/services/staticMapService.js',()=>({fetchStaticMap:async()=>null,mapPointsIpVsHome:()=>[],mapPointsHomeVsDeclared:()=>[],mapPointsDeclaredVsIp:()=>[]}));
const {buildReportPdf}=await import('../src/services/reportPdfService.js');
const {PDFParse}=await import('pdf-parse');
const analysis={id:'regressao-pdf',createdAt:new Date()};
it('gerador também bloqueia chamada direta, independentemente do controller',async()=>{
 const result={text:JSON.stringify({trilha_eventos:{eventos:[{nome:'Aceite'}]}}),coerencia:[],coerencia_bloqueante:false,sumarioIrregularidades:{synthesis:'ausência integral de trilha'}};
 await expect(buildReportPdf(analysis,result)).rejects.toMatchObject({code:'COERENCIA',status:409});
});
it('PDF corrigido é pesquisável e preserva nome com acento decomposto',async()=>{
 const result={text:'{}',file:{name:'dossie\u0302 (1).pdf'},hashes:{sha256:'a'.repeat(64)},generatedAt:new Date().toISOString()};
 const doc=await buildReportPdf(analysis,result);const chunks=[];for await(const c of doc)chunks.push(c);const bytes=Buffer.concat(chunks);
 expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
 const parser=new PDFParse({data:bytes});try{const text=(await parser.getText()).text;expect(text).toContain('dossiê (1).pdf');expect(text).toContain('Identificação');}finally{await parser.destroy();}
});
