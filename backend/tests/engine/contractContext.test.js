import { describe, it, expect } from 'vitest';
import { extractContractContext, extractExtendedContractFields, readLabeledCell } from '../../src/engine/contractContext.js';
import { heuristicExtractionFromText } from '../../src/engine/extraction.js';
import { classificarProduto } from '../../src/engine/produto.js';
import { camposDaReferencia, ufDoTexto } from '../../src/utils/referenciaResidencial.js';
import { numeroContratoPlausivel } from '../../src/engine/salvaguardas.js';
import { avaliarAssinaturaPorDocumento } from '../../src/engine/documentosLogicos.js';

describe('campos do instrumento com papel, rótulo e coluna',()=>{
  it('prefere a CCB à proposta e ao contrato antigo',()=>{
    const c=extractContractContext('CÉDULA DE CRÉDITO BANCÁRIO DE RENEGOCIAÇÃO DE EMPRÉSTIMO CONSIGNADO Nº 123456789\nNº da Proposta: 987654321\nNº Contrato anterior: 555555555');
    expect(c.contratoNumero).toBe('123456789');
  });
  it('preserva identificador UUID completo sob rótulo CCB',()=>{
    const c=extractExtendedContractFields('CCB nº:\nTIPO DE OPERAÇÃO:\nEMPRÉSTIMO CONSIGNADO       12345678-abcd-abcd-abcd-123456789abc');
    expect(c.contratoNumero).toBe('12345678-abcd-abcd-abcd-123456789abc');
  });
  it('não confunde banco da conta com o credor',()=>{
    const c=extractContractContext('CCB Nº: 12345678\nII – CREDOR ORIGINÁRIO\nBanco Inbursa S.A. CNPJ/MF nº: 04.866.275/0001-63\nDADOS BANCÁRIOS: Banco Bradesco S.A. CNPJ 60.746.948/0001-12');
    expect(c.banco).toContain('Inbursa');expect(c.cnpjInstituicao).toBe('04866275000163');
  });
  it('lê valor abaixo do rótulo no mesmo alinhamento',()=>{
    const t='4.3. Valor da Parcela:             4.4. Quantidade de Parcelas:            4.5. Taxa de Juros Efetiva Mensal:\nR$ 52,18                           96                                     1,73 %';
    const c=extractContractContext(t);expect(c.valorParcela).toBe('R$ 52,18');expect(c.numeroParcelas).toBe('96');expect(c.taxaJurosMensal).toBe('1,73%');
  });
  it('não lê o número do próximo campo como quantidade',()=>{
    expect(readLabeledCell('6 - Quantidade Parcelas 7 - Valor da(s) Parcela(s)',/Quantidade Parcelas/i,'(\\d{1,3})(?![\\d.,])')).toBeNull();
  });
  it('não apaga parcelas de empréstimo por menção incidental a RMC',()=>{
    const c=heuristicExtractionFromText('CÉDULA DE CRÉDITO BANCÁRIO\nEMPRÉSTIMO CONSIGNADO\nValor da Parcela: R$ 45,32\nQuantidade de Parcelas: 48\nCondições: a dívida anterior de cartão RMC poderá ser quitada.').contrato;
    expect(c.modalidade).toBe('Emprestimo Consignado');expect(c.numero_parcelas).toBe('48');expect(c.valor_parcela).toBe('R$ 45,32');
  });
  it('campo INSS preenchido prevalece sobre texto genérico de rescisão',()=>{
    const p=classificarProduto('Fonte Pagadora: CNPJ/MF:\nINSS 29.979.036/0001-40\nVerbas rescisórias, saldo do FGTS, folha de pagamento, vínculo empregatício.');
    expect(p.codigo).toBe('CONSIGNADO_INSS');
  });
  it('clausulado genérico sem marcador estrutural não afirma CLT',()=>{
    expect(classificarProduto('Verbas rescisórias, saldo do FGTS, folha de pagamento, vínculo empregatício.').codigo).toBe('INDETERMINADO');
  });
  it('mantém CLT quando campo da própria operação a declara',()=>{
    expect(classificarProduto('INSTITUIÇÃO CONSIGNANTE / EMPREGADOR: 000007 - CONSIG TRAB\nInformações ratificadas pelo INSS.').codigo).toBe('CONSIGNADO_CLT');
  });
  it('data de emissão pontuada tem precedência sobre data do rodapé',()=>{
    expect(extractExtendedContractFields('2.13. Data e local de emissão desta Cédula: 09.02.2022 - CIDADE\nRodapé impresso em 21/03/2024').dataContrato).toBe('09/02/2022');
  });
  it('não trunca código de convênio para inventar parcelas no OCR',()=>{
    const c=extractExtendedContractFields('5 - Cad. Convênio E - Otde. de Parcelas\n55585 72');expect(c.numeroParcelas).toBe('72');
  });
  it('endereço separado por hífens preserva UF e CEP',()=>{
    expect(ufDoTexto('Rua X, 945 - Pedro II - PI - 64255-000')).toBe('PI');expect(camposDaReferencia('Rua X, Manaquiri - AM - 69.435-000').cep).toBe('69435000');
  });
  it('não afirma ausência no contrato inteiro usando apenas um dos fragmentos',()=>{
    const d=(a,b,blocks)=>({tipo:'INSTRUMENTO_PRINCIPAL',titulo:'CCB',tituloDetectado:true,paginaInicial:a,paginaFinal:b,blocosAssinatura:blocks});
    const r=avaliarAssinaturaPorDocumento({confiavel:true,documentos:[d(1,2,[]),d(4,5,[{pagina:5,tipo:'BLOCO_ASSINATURA'}])]});expect(r.achado).toBeNull();expect(r.resumo).toContain('págs. 1 a 2');expect(r.resumo).toContain('págs. 4 a 5');
  });
  it('não classifica crédito empresarial como FGTS por cláusula genérica',()=>{
    const c=heuristicExtractionFromText('CEDULA DE CREDITO BANCARIO\n1. EMITENTE:\n1.2.CPF / CNPJ: 12.345.678/0001-90\n2. DADOS DA OPERAÇÃO:\nRegularidade fiscal: FGTS e tributos.').contrato;
    expect(c.modalidade).toBe('CREDITO_PESSOA_JURIDICA');expect(c.produto_codigo).toBe('CREDITO_PJ');
  });
  it('identificadores não aceitam CNPJ, data ou URL',()=>{
    for(const x of ['12.345.678/0001-90','10/02/2023','https://site/contrato12345']) expect(numeroContratoPlausivel(x)).toBe(false);
    expect(numeroContratoPlausivel('55-123456789/23')).toBe(true);
  });
  it('OCR de tabela financeira sem colunas requer revisão antes dos cálculos',()=>{
    const c=heuristicExtractionFromText('--- OCR page-1.png ---\nCédula de Crédito Bancário - Empréstimo Pessoal\nConsignação e/ou Retenção - INSS - Refinanciamento\nValor dof Novos Recursos |.2 - Valor Total do Empréstimo\n2.700,00 ?????\nValor da parcela: R$ 200,00').contrato;
    expect(c.revisao_financeira_obrigatoria).toBe(true);expect(c.valor_total_emprestimo).toBeNull();expect(c.taxa_juros_mensal).toBeNull();expect(c.tipo_operacao).toBe('REFINANCIAMENTO');
  });

});
