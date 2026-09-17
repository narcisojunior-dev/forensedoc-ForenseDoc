#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera autos sintéticos para exercitar o leitor e a bateria forense.

Nada aqui reproduz caso real. São documentos inventados, com defeitos plantados
de propósito, para verificar se o programa encontra o que deveria encontrar.
"""
import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import cm

DESTINO = sys.argv[1] if len(sys.argv) > 1 else "autos_teste"


def pdf(nome, paginas, produtor="Gerador de Teste"):
    os.makedirs(DESTINO, exist_ok=True)
    c = canvas.Canvas(os.path.join(DESTINO, nome), pagesize=A4)
    c.setProducer(produtor)
    for linhas in paginas:
        y = 27 * cm
        for l in linhas:
            c.setFont("Helvetica", 9.5)
            c.drawString(2 * cm, y, l[:110])
            y -= 0.48 * cm
        c.showPage()
    c.save()


# 0 · petição inicial: pede cinco temas, afirma analfabetismo, protesta provar
pdf("00_inicial.pdf", [[
    "EXCELENTISSIMO SENHOR DOUTOR JUIZ DE DIREITO DA VARA CIVEL DA COMARCA DE PEDRO II/PI",
    "",
    "MARIA DE JESUS SOUSA, brasileira, aposentada, portadora do CPF 123.456.789-00,",
    "vem, respeitosamente, propor ACAO DECLARATORIA DE INEXISTENCIA DE DEBITO cumulada",
    "com repeticao de indebito e indenizacao por danos morais em face de BANCO EXEMPLO S.A.",
    "",
    "I - DOS FATOS",
    "A autora e analfabeta e nao sabe ler nem escrever, identificando-se por impressao digital.",
    "Constatou desconto mensal em seu beneficio previdenciario referente ao contrato 433969943,",
    "que jamais celebrou. Nao recebeu qualquer valor a titulo de emprestimo.",
    "Valor descontado: R$ 55,00 por competencia.",
    "",
    "II - DA TUTELA DE URGENCIA",
    "Requer a concessao de tutela de urgencia para a cessacao imediata dos descontos,",
    "diante da natureza alimentar do beneficio.",
    "",
    "III - DO DIREITO",
    "Requer a inversao do onus da prova, nos termos do artigo 6, inciso VIII, do CDC.",
    "Requer a exibicao de documentos pela instituicao, na forma do artigo 396 do CPC.",
    "",
    "IV - DOS PEDIDOS",
    "a) a declaracao de inexistencia do debito e do contrato;",
    "b) a repeticao do indebito, com devolucao em dobro dos valores descontados;",
    "c) a condenacao ao pagamento de indenizacao por danos morais;",
    "d) a inversao do onus da prova.",
    "Protesta provar por todos os meios, inclusive pericia grafotecnica.",
    "Da-se a causa o valor de R$ 15.000,00.",
]])

# 1 · contestação, com três preliminares e prova anunciada e não juntada
pdf("01_contestacao.pdf", [[
    "EXCELENTISSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 2a VARA CIVEL DA COMARCA DE PEDRO II/PI",
    "Processo n. 0801234-56.2026.8.18.0065",
    "BANCO EXEMPLO S.A., ja qualificado, vem, respeitosamente, apresentar CONTESTACAO",
    "aos termos da acao proposta por MARIA DE JESUS SOUSA.",
    "",
    "I - PRELIMINARMENTE",
    "1. Da falta de interesse de agir. A autora nao formulou previo requerimento administrativo",
    "perante a instituicao, o que revela ausencia de interesse processual.",
    "2. Da impugnacao a gratuidade da justica. A declaracao de hipossuficiencia nao se sustenta.",
    "3. Da litigancia predatoria. O escritorio subscritor ajuizou centenas de demandas identicas,",
    "conforme Recomendacao n. 159 do Conselho Nacional de Justica, requerendo-se ainda a",
    "condenacao solidaria do advogado subscritor por litigancia de ma-fe.",
    "",
    "II - DO MERITO",
    "A contratacao e regular, conforme contrato e comprovante de transferencia ora juntados.",
    "Registre-se que a autora e analfabeta, o que nao impede a contratacao por rogo.",
    "No processo n. 0899999-11.2025.8.18.0140, envolvendo a autora ANTONIA LIMA COSTA,",
    "este juizo ja reconheceu a regularidade do contrato 987654321.",
    "O extrato bancario da conta da autora, em anexo, demonstra o recebimento do valor.",
    "Junta-se ainda o parecer tecnico do setor de seguranca e o log completo da jornada.",
    "Requer a improcedencia total dos pedidos.",
]])

# 2 · contrato: rogo sem testemunhas, formulário posterior, CET sem demonstrativo,
#     taxa declarada divergente do que os números produzem
pdf("02_contrato.pdf", [[
    "CEDULA DE CREDITO BANCARIO - EMPRESTIMO CONSIGNADO",
    "BANCO EXEMPLO S.A.",
    "Contrato n. 433969943",
    "Data: 06/05/2021",
    "",
    "CONTRATANTE: MARIA DE JESUS SOUSA",
    "CPF: 123.456.789-00",
    "Beneficio n. 123.456.789-0",
    "",
    "Valor liberado: R$ 2.124,06",
    "Valor da parcela: R$ 55,00",
    "Prazo: 84 parcelas",
    "Taxa de juros: 1,60% ao mes",
    "CET: 2,15% ao mes",
    "",
    "Assinatura a rogo de MARIA DE JESUS SOUSA, por JOAO PEREIRA DA SILVA",
    "CPF do rogatario: 987.654.321-00",
    "",
    "TESTEMUNHA 1: ____________________________",
    "",
    "Mod. 4840-1295E, Versao 08/2024",
]])

# 3 · comprovante: sem conta destinatária, sem autenticação, sem horário
pdf("03_comprovante.pdf", [[
    "COMPROVANTE DE TRANSFERENCIA ELETRONICA",
    "BANCO EXEMPLO S.A.",
    "Tipo: TED",
    "Data: 06/05/2021",
    "Valor: R$ 2.100,00",
    "Instituicao emitente: BANCO EXEMPLO S.A.",
    "Favorecido: MARIA DE JESUS SOUSA",
    "Observacao: reserva de imagem do sistema interno",
]])

# 4 · histórico de consignações, com desconto anterior ao contrato
pdf("04_hiscre.pdf", [[
    "HISCRE - HISTORICO DE CONSIGNACOES",
    "INSTITUTO NACIONAL DO SEGURO SOCIAL",
    "Beneficio n. 123.456.789-0",
    "Titular: MARIA DE JESUS SOUSA",
    "Margem consignavel",
    "",
    "Competencia 03/2021  Contrato 433969943  Banco Exemplo  Parcela R$ 55,00",
    "Competencia 04/2021  Contrato 433969943  Banco Exemplo  Parcela R$ 55,00",
    "Competencia 05/2021  Contrato 433969943  Banco Exemplo  Parcela R$ 55,00",
    "Data do primeiro desconto: 05/03/2021",
]])

# 5 · log de jornada de ambiente de homologação, sem IP e sem biometria
pdf("05_log_jornada.pdf", [[
    "LOG - JORNADA SIMPLIFICADA DO CLIENTE",
    "Sessao: 88213",
    "Saudacao: DDS TESTE TI AUTO ATENDIMENTO",
    "Cliente: NOME DO BENEFICIARIO HOMOL",
    "Dispositivo: LETRA DE ACESSO",
    "Etapa 1 - abertura da jornada",
    "Etapa 2 - confirmacao em 04/05/2021",
    "Hash do documento: 9f2c4a71b3e85d06a7c1f4b29e3d5a8c7061b2d4",
]])

# ---------------------------------------------------------------------------
# Regressão de 0826620-35.2025: contratação por aplicativo, sem rogo em página
# alguma, autora analfabeta, mesmo IP em dois dias. É o caso em que o lote de
# validação escolheu o art. 595 do Código Civil e a réplica real atacava a
# trilha eletrônica. Vive em subpasta própria para não contaminar o outro lote.
# ---------------------------------------------------------------------------
DESTINO_APP = os.path.join(DESTINO, "..", "autos_teste_app")
DESTINO_APP = os.path.normpath(DESTINO_APP)


def pdf_app(nome, linhas):
    global DESTINO
    guardado, DESTINO = DESTINO, DESTINO_APP
    try:
        pdf(nome, [linhas])
    finally:
        DESTINO = guardado


pdf_app("00_inicial.pdf", [
    "EXCELENTISSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 3a VARA CIVEL DA COMARCA DE TERESINA/PI",
    "Processo n. 0899999-99.2025.8.18.0140",
    "JOANA PEREIRA DOS SANTOS, brasileira, aposentada, portadora do CPF 111.222.333-44,",
    "vem, respeitosamente, propor ACAO DECLARATORIA DE INEXISTENCIA DE DEBITO cumulada",
    "com repeticao de indebito e indenizacao por danos morais em face de BANCO EXEMPLO S.A.",
    "A autora e analfabeta e nao sabe ler nem escrever.",
    "Desconto mensal referente ao contrato 778899001, que jamais celebrou.",
    "Requer tutela de urgencia para a cessacao imediata dos descontos.",
    "Requer a exibicao de documentos, artigo 396 do CPC.",
    "a) a declaracao de inexistencia do debito e do contrato;",
    "b) a repeticao do indebito, com devolucao em dobro;",
    "c) a condenacao ao pagamento de indenizacao por danos morais.",
    "Protesta provar por todos os meios, inclusive pericia.",
])
pdf_app("01_contestacao.pdf", [
    "AO JUIZO DA 3a VARA CIVEL DA COMARCA DE TERESINA/PI",
    "Processo n. 0899999-99.2025.8.18.0140",
    "BANCO EXEMPLO S.A. vem apresentar CONTESTACAO a acao proposta por JOANA PEREIRA DOS SANTOS.",
    "1. Da falta de interesse de agir. Nao houve previo requerimento administrativo.",
    "O emprestimo foi contratado via aplicativo do banco, com uso de senha pessoal,",
    "token e/ou biometria, na forma da MP 2.200-2/2001 e da Lei 14.063/2020.",
    "A assinatura eletronica e valida e a contratacao e regular.",
    "Junta-se o log completo da jornada de contratacao. Requer a improcedencia.",
])
pdf_app("02_contrato.pdf", [
    "CEDULA DE CREDITO BANCARIO - CONSIGNADO INSS",
    "Contratacao por Aplicativo (App)", "BANCO EXEMPLO S.A.",
    "Contrato n. 778899001", "Data: 13/01/2024",
    "CONTRATANTE: JOANA PEREIRA DOS SANTOS", "CPF: 111.222.333-44",
    "Valor liberado: R$ 3.000,00", "Valor da parcela: R$ 90,00",
    "Prazo: 84 parcelas", "CET: 2,00% ao mes",
    "Aceite eletronico mediante senha pessoal, token e/ou biometria.",
])
pdf_app("03_log_jornada.pdf", [
    "LOG DE JORNADA DE CONTRATACAO", "Sessao: 55120",
    "Etapa 1 - acesso em 13/01/2024 as 10:12:04 - IP 45.188.158.0",
    "Etapa 2 - confirmacao em 14/01/2024 as 09:41:55 - IP 45.188.158.0",
    "Dispositivo: LETRA DE ACESSO",
    "Observacao: token e/ou biometria",
])
pdf_app("04_outro_contrato.pdf", [
    "LOG DE JORNADA DE CONTRATACAO - OUTRO CONTRATANTE",
    "Contratante: ANTONIO DA SILVA BARROS", "Contrato n. 665544332",
    "Etapa 1 - acesso em 13/01/2024 as 11:02:31 - IP 45.188.158.0",
    "Dispositivo: LETRA DE ACESSO",
])

print("autos sintéticos gravados em", DESTINO)
print("autos de contratação por aplicativo em", DESTINO_APP)
