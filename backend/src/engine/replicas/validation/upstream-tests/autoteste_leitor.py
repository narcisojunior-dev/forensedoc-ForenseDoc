#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bateria de verificação do leitor de autos e da bateria forense."""
import os
import re
import sys
import json
import shutil
import subprocess
import threading
import time
import urllib.request

import leitor
import forense
import processual
import motor_replicas as M

import tempfile

falhas, testes = [], 0
# os autos sintéticos vão para uma pasta temporária: sem estado velho entre
# execuções e sem escrever nada na pasta de trabalho
PASTA = os.path.join(tempfile.gettempdir(), "motor_replicas_autos_teste")


def ok(cond, nome, detalhe=""):
    global testes
    testes += 1
    if not cond:
        falhas.append("%s %s" % (nome, detalhe))


def sinal(S, codigo):
    return [s for s in S if s.codigo == codigo]


# ---- preparar os autos sintéticos ------------------------------------
shutil.rmtree(PASTA, ignore_errors=True)
shutil.rmtree(os.path.join(os.path.dirname(PASTA), "autos_teste_app"),
              ignore_errors=True)
subprocess.run([sys.executable, "gerar_autos_teste.py", PASTA], check=True)

arquivos = leitor.coletar(PASTA)
ok(len(arquivos) == 6, "L01 seis arquivos coletados", "(%d)" % len(arquivos))

L = leitor.ler_autos(arquivos, usar_ocr=False)

# ---- 1 · extração e classificação ------------------------------------
ok(all(d.paginas for d in L.documentos), "L02 todo documento rendeu página")
ok(all(d.sha256 and len(d.sha256) == 64 for d in L.documentos), "L03 hash de cada arquivo")
tipos = {d.nome: d.tipo for d in L.documentos}
esperado = {
    "00_inicial.pdf": "inicial",
    "01_contestacao.pdf": "contestacao", "02_contrato.pdf": "contrato",
    "03_comprovante.pdf": "comprovante", "04_hiscre.pdf": "hiscre",
    "05_log_jornada.pdf": "log",
}
for nome, tipo in esperado.items():
    ok(tipos.get(nome) == tipo, "L04 %s classificado como %s" % (nome, tipo),
       "(veio %s)" % tipos.get(nome))

# ---- 2 · diagnóstico a partir dos autos ------------------------------
esperadas = {"contrato": "papel", "assinatura": "rogo", "testemunhas": "nenhuma",
             "portabilidade": "nao", "repasse": "imagem", "conta": "nao",
             "extrato": "ausente", "valores": "nao"}
for campo, valor in esperadas.items():
    a = L.achados.get(campo)
    ok(a and a.valor == valor, "L05 %s lido como %s" % (campo, valor),
       "(veio %s)" % (a.valor if a else "nada"))

# a ré admitiu o analfabetismo na contestação: é a origem mais forte
ok(L.achados["impossibilidade"].valor == "provada", "L06 impossibilidade lida da admissão da ré",
   "(veio %s)" % L.achados["impossibilidade"].valor)
ok(L.achados["impossibilidade"].confianca == "alta", "L07 com confiança alta, por ser admissão")
ok("admiss" in L.achados["impossibilidade"].nota.lower(), "L07b a nota explica a origem")
ok(L.achados["impossibilidade"].evidencias, "L07c com o trecho da contestação")

# sem a admissão da ré, a alegação da inicial sozinha não vira prova
import copy as _copy
_L3 = _copy.copy(L)
_L3.documentos = [d for d in L.documentos if d.tipo != "contestacao"]
_A3 = leitor.ler_autos([d.caminho for d in _L3.documentos], usar_ocr=False)
ok(_A3.achados["impossibilidade"].valor == "semprova",
   "L07d alegação só na inicial volta como prova a juntar",
   "(veio %s)" % _A3.achados["impossibilidade"].valor)
ok("afirma[çc]" in _A3.achados["impossibilidade"].nota
   or "não é prova" in _A3.achados["impossibilidade"].nota,
   "L07e e a nota diz por quê")
ok(all(a.confianca in ("alta", "media", "baixa") for a in L.achados.values()),
   "L08 toda resposta tem grau de confiança")
com_ev = [k for k, a in L.achados.items() if a.confianca == "alta" and a.valor
          and a.valor not in ("nada", "na", "ausente")]
for k in com_ev:
    ok(L.achados[k].evidencias, "L09 achado de confiança alta traz evidência: %s" % k)
for k, a in L.achados.items():
    for e in a.evidencias:
        ok(e.get("arquivo") and e.get("pagina"), "L10 evidência localizada em %s" % k)

# ---- 3 · dados do processo -------------------------------------------
ok(L.dados.get("processo") == "0801234-56.2026.8.18.0065", "L11 número do processo",
   "(veio %s)" % L.dados.get("processo"))
ok(L.dados.get("vara") == "2ª", "L12 vara", "(veio %s)" % L.dados.get("vara"))
ok(L.dados.get("comarca") == "Pedro II", "L13 comarca com maiúsculas corretas",
   "(veio %s)" % L.dados.get("comarca"))
ok(L.dados.get("contrato_n") == "433969943", "L14 número do contrato")
ok(L.dados.get("parcelas") == "84", "L15 quantidade de parcelas")
ok(L.dados.get("valor_liberado") == "R$ 2.124,06", "L16 valor liberado formatado",
   "(veio %s)" % L.dados.get("valor_liberado"))

# ---- 4 · preliminares efetivamente arguidas ---------------------------
cods = [p["cod"] for p in L.preliminares]
ok("III.1" in cods, "L17 interesse de agir localizado")
ok("III.3" in cods, "L18 gratuidade localizada")
ok("III.4" in cods, "L19 litigância predatória localizada")
ok("III.2" not in cods, "L20 inépcia não foi inventada")
ok("III.5" not in cods, "L21 prescrição não foi inventada")
for p in L.preliminares:
    ok(p["evidencia"]["trecho"], "L22 preliminar traz o trecho da contestação")

# ---- 5 · conformidade com a Súmula 69 --------------------------------
ok(len(L.conformidade69) == 8, "L23 os oito itens do enunciado foram conferidos")
sit = {x["item"]: x["situacao"] for x in L.conformidade69}
for item in ("a", "d", "e", "h"):
    ok(sit.get(item) == "ausente", "L24 item %s ausente no comprovante" % item)
for item in ("b", "c", "f", "g"):
    ok(sit.get(item) == "presente", "L25 item %s presente no comprovante" % item)

# ---- 6 · bateria forense ---------------------------------------------
S = forense.periciar(L)
r = forense.resumo(S)
ok(len(S) > 12, "L26 bateria produziu achados", "(%d)" % len(S))
ok(r["critico"] >= 3, "L27 achados críticos encontrados", "(%d)" % r["critico"])

for cod, rotulo in [
    ("AMB-01", "ambiente de homologação no log"),
    ("MOD-01", "formulário posterior à data do contrato"),
    ("CRO-02", "desconto anterior ao contrato"),
    ("HSH-01", "hash do log que não confere"),
    ("CET-01", "CET sem demonstrativo"),
    ("TAX-01", "taxa efetiva recalculada"),
    ("AUT-02", "comprovante sem autenticação"),
    ("ANX-01", "documento anunciado e não juntado"),
    ("SIG-01", "sem assinatura criptográfica"),
    ("TRI-01", "trilha sem IP"),
    ("TRI-03", "trilha sem biometria"),
    ("META-01", "PDF gerado muito depois"),
]:
    ok(sinal(S, cod), "L28 encontrou %s" % rotulo)

# o que não existe não pode ser afirmado
ok(not sinal(S, "NUM-01"), "L29 não acusou divergência de número que não existe")
ok(sinal(S, "NUM-02"), "L30 registrou que o número do contrato confere")
ok(not sinal(S, "CRO-01"), "L31 não acusou repasse anterior ao contrato")
ok(not sinal(S, "IP-01"), "L32 não acusou IP repetido sem IP nos autos")

# META-01 não deve disparar na contestação, que é peça produzida agora
meta = sinal(S, "META-01")
ok(all("contestacao" not in s.arquivo for s in meta),
   "L33 metadado de data não acusa a contestação")

# todo sinal precisa carregar dado ou arquivo
for s in S:
    ok(s.dado or s.arquivo, "L34 sinal %s carrega o dado que o sustenta" % s.codigo)
    ok(s.gravidade in forense.GRAVIDADE, "L35 gravidade válida em %s" % s.codigo)
    ok("—" not in s.detalhe and "–" not in s.detalhe,
       "L36 sinal %s sem travessão longo" % s.codigo)

# ordenação por gravidade
niveis = [forense.GRAVIDADE[s.gravidade] for s in S]
ok(niveis == sorted(niveis, reverse=True), "L37 achados ordenados por gravidade")

# ---- 7 · recálculo de taxa -------------------------------------------
i = forense.taxa_mensal(2124.06, 55.0, 84)
ok(i is not None and 0.021 < i < 0.022, "L38 taxa de 84x55 sobre 2.124,06",
   "(%s)" % i)
ok(forense.taxa_mensal(1000.0, 100.0, 12) is not None, "L39 caso comum resolve")
ok(forense.taxa_mensal(1000.0, 50.0, 12) is None,
   "L40 devolve nada quando as parcelas não pagam o principal")
ok(forense.taxa_mensal(0, 55.0, 84) is None, "L41 rejeita valor liberado zero")
ok(forense.taxa_mensal(1000.0, 1000.0, 1) is not None, "L42 parcela única resolve")
ok(forense.fmt(2124.06) == "R$ 2.124,06", "L43 moeda com separador de milhar",
   "(%s)" % forense.fmt(2124.06))
ok(forense.fmt(1234567.8) == "R$ 1.234.567,80", "L44 milhão formatado",
   "(%s)" % forense.fmt(1234567.8))
ok(forense.pct(2.5) == "2,50%", "L45 percentual com vírgula", "(%s)" % forense.pct(2.5))
ok(forense.pct(29.2071) == "29,21%", "L45b percentual arredondado")

# ---- 7b · análise processual -----------------------------------------
P = processual.analisar(L)


def psinal(cod):
    return [s for s in P if s.codigo == cod]


ok(len(P) >= 6, "L70a análise processual produziu achados", "(%d)" % len(P))
ok(psinal("PRO-05"), "L70b achou o número de processo estranho na defesa")
ok(psinal("PRO-06"), "L70c achou o contrato estranho citado na defesa")
ok(psinal("PRO-07"), "L70d achou o nome de parte estranho na defesa")
ok(psinal("PRO-03"), "L70e achou a admissão da ré sobre o analfabetismo")
ok(psinal("PRO-01"), "L70f apontou pontos sem correspondência na defesa")
ok(psinal("DOC-01"), "L70g apontou documento essencial da autora ausente")
ok(psinal("DOC-05"), "L70h apontou documento anunciado na defesa e não juntado")
ok(psinal("MAR-01"), "L70i apontou tutela pedida e sem decisão")
ok(psinal("DOC-03"), "L70j registrou que a inicial afirma a impossibilidade de assinar")
ok(not psinal("PRO-00"), "L70k não reclamou de inicial ausente havendo inicial")
ok(not psinal("PRO-00b"), "L70l não reclamou de contestação ausente havendo contestação")
ok(not psinal("PRO-04"), "L70m não acusou contrato diverso do discutido sem divergência")
ok(not psinal("DOC-06"), "L70n não acusou falta de contrato havendo contrato")
ok(not psinal("MAR-02"), "L70o não acusou falta de requerimento de prova havendo protesto")

# PRO-01 precisa ser cauteloso: indício, e nunca afirmação de silêncio
p1 = (psinal("PRO-01") or [None])[0]
ok(p1 is not None and p1.gravidade == "medio",
   "L70p ponto sem correspondência é indício, não conclusão")
ok(p1 is not None and "e não prova dela" in p1.detalhe,
   "L70q o texto ressalva o limite da busca por termos")
ok(p1 is not None and "341" in p1.detalhe, "L70r cita o dispositivo aplicável")

# ônus da autora precisa estar dito onde a lacuna é dela
d1 = (psinal("DOC-01") or [None])[0]
ok(d1 is not None and "ônus aqui é da autora" in d1.detalhe,
   "L70s diz de quem é o ônus na lacuna da inicial")

# partes extraídas das peças
ok(L.dados.get("autor") == "MARIA DE JESUS SOUSA", "L70t autora extraída",
   "(veio %s)" % L.dados.get("autor"))
ok(L.dados.get("re") == "BANCO EXEMPLO S.A.", "L70u ré extraída",
   "(veio %s)" % L.dados.get("re"))

for s in P:
    ok(s.dado or s.arquivo, "L70v sinal %s carrega o dado que o sustenta" % s.codigo)
    ok("—" not in s.detalhe and "–" not in s.detalhe,
       "L70w sinal %s sem travessão longo" % s.codigo)

# sem inicial na pasta, o programa avisa em vez de calar
import copy
L2 = copy.copy(L)
L2.documentos = [d for d in L.documentos if d.tipo != "inicial"]
P2 = processual.analisar(L2)
ok([s for s in P2 if s.codigo == "PRO-00"], "L70x avisa quando falta a inicial")

# ---- 8 · montagem alimentada pela leitura ----------------------------
dados = dict(L.dados)
dados.update({"autor": "MARIA DE JESUS SOUSA", "re": "BANCO EXEMPLO S.A.",
              "uf": "PI", "advogado": "RONNEY WELLYNGTON MENEZES DOS ANJOS",
              "oab": "15.508", "cidade": "Pedro II", "data": "27 de agosto de 2026"})
prel = set(p["cod"] for p in L.preliminares)

respostas = {k: a.valor for k, a in L.achados.items()
             if a.valor and a.confianca in ("alta", "media")}
cand = M.diagnosticar(respostas)
ok(cand and cand[0]["letra"] == "A", "L46 diagnóstico dos autos elege o cenário A",
   "(veio %s)" % [c["letra"] for c in cand])
ok(any(c["letra"] == "G" for c in cand), "L47 cenário G aparece como transplantável")

sem = M.montar("G", {}, prel, conformidade=[])
com = M.montar("G", dados, prel, conformidade=L.conformidade69)
p_sem = sum(len(re.findall(r"\[[^\]]{1,90}\]", p["t"])) for p in sem)
p_com = sum(len(re.findall(r"\[[^\]]{1,90}\]", p["t"])) for p in com)
ok(p_com < p_sem, "L48 a leitura reduz as pendências", "(%d para %d)" % (p_sem, p_com))
ok(p_com <= 4, "L49 sobram poucas pendências", "(%d)" % p_com)

txt = "\n".join(p["t"] for p in com)
ok("433969943" in txt, "L50 número do contrato entrou na peça")
ok("03_comprovante.pdf" in txt, "L51 folhas do comprovante entraram na peça G")
com_l = "\n".join(p["t"] for p in M.montar("L", dados, prel, conformidade=L.conformidade69))
ok("2.124,06" in com_l, "L51b valor liberado entrou na peça L")
ok("2.100,00" in com_l, "L51c valor transferido entrou na peça L")
ok("em 06/05/2021" in com_l, "L51d data da transferência entrou na peça L")
ok(re.search(r"iniciado em \d{2}/03/2021", com_l), "L51e primeira competência entrou na peça L")
ok("em 3 competências" in com_l, "L51h competências contadas, não confundidas com parcelas")
ok("em 84 parcelas" in com_l or "84 parcelas" in com_l, "L51i parcelas preservadas")
ok(com_l.rstrip().endswith("OAB/PI nº 15.508"), "L51f fecho preservado")
ok("Pedro II/PI, 27 de agosto de 2026." in com_l, "L51g data da assinatura no fecho")
ok("a) autenticação bancária verificável: ausente" in txt,
   "L52 item a da Súmula 69 preenchido pela leitura")
ok("e) identificação das respectivas contas: ausente;" in txt,
   "L53 item e preenchido como ausente")
ok("f) valor transferido: presente;" in txt, "L54 item f preenchido como presente")
ok("[ausente ou presente]" not in txt, "L55 nenhum item do enunciado ficou em aberto")

# o preenchimento não pode inventar onde o dado falta
vazio = M.montar("G", {"autor": "X"}, prel, conformidade=[])
tv = "\n".join(p["t"] for p in vazio)
ok("[valor]" in tv, "L56 sem dado lido, o colchete permanece aberto")
ok("[número]" in tv, "L57 idem para o número")

# ---- 9 · relatório de achados ----------------------------------------
caminho = M.gerar_relatorio(L, P + S, dados)
ok(os.path.exists(caminho), "L58 relatório gravado")
try:
    import docx
    d2 = docx.Document(caminho)
    linhas = [p.text for p in d2.paragraphs if p.text.strip()]
    ok(any("RELATÓRIO DE ACHADOS" in x for x in linhas), "L59 relatório tem título")
    ok(any("LIMITAÇÕES" in x for x in linhas), "L60 relatório declara suas limitações")
    ok(any("EXIBIÇÕES E PROVIDÊNCIAS" in x for x in linhas), "L61 relatório lista as exibições")
    ok(any("ACHADOS PROCESSUAIS" in x for x in linhas), "L61b relatório separa o processual")
    ok(any("ACHADOS SOBRE OS ARQUIVOS" in x for x in linhas), "L61c e o documental")
    ok(any("SHA-256" in x or "sha" in x.lower() for x in linhas),
       "L62 relatório registra o hash dos arquivos")
    ok(sum(1 for x in linhas if "peça processual" in x.lower()) == 1,
       "L63 relatório avisa que não vai aos autos")
except ImportError:
    pass
try:
    os.remove(caminho)
except OSError:
    pass

# ---- 10 · servidor local ---------------------------------------------
srv = None
try:
    from http.server import HTTPServer
    srv = HTTPServer(("127.0.0.1", 8799), M.App)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.3)

    def post(rota, corpo):
        req = urllib.request.Request(
            "http://127.0.0.1:8799" + rota,
            data=json.dumps(corpo).encode(),
            headers={"Content-Type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=120).read())

    pag = urllib.request.urlopen("http://127.0.0.1:8799/", timeout=20).read().decode()
    ok("Motor de Réplicas" in pag, "L64 página servida")
    dd = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:8799/api/dados", timeout=20).read())
    ok(len(dd["replicas"]) == 15, "L65 quinze réplicas na API")

    r1 = post("/api/ler", {"pasta": PASTA, "ocr": False})
    ok(len(r1["documentos"]) == 6, "L66 leitura pela API")
    ok(r1["resumo"]["critico"] >= 3, "L67 críticos pela API")
    ok(len(r1["conformidade69"]) == 8, "L68 conformidade pela API")

    r2 = post("/api/ler", {"pasta": "/pasta/que/nao/existe"})
    ok("erro" in r2, "L69 pasta inexistente devolve erro, não quebra")

    r3 = post("/api/diagnostico", {"respostas": respostas})
    ok(r3["candidatos"][0]["letra"] == "A", "L70 diagnóstico pela API")

    r4 = post("/api/montar", {"letra": "A", "dados": dados,
                              "preliminares": list(prel),
                              "conformidade": r1["conformidade69"]})
    ok(len(r4["paragrafos"]) > 60, "L71 montagem pela API")

    r5 = post("/api/gerar", {"letra": "A", "dados": dados,
                             "paragrafos": r4["paragrafos"]})
    ok(os.path.exists(r5["caminho"]), "L72 DOCX gerado pela API")
    try:
        os.remove(r5["caminho"])
    except OSError:
        pass

    r6 = post("/api/relatorio", {"dados": dados})
    ok(os.path.exists(r6["caminho"]), "L73 relatório gerado pela API")
    try:
        os.remove(r6["caminho"])
    except OSError:
        pass
finally:
    if srv:
        srv.shutdown()

# ======================================================================
# 11 · regressão dos P0 da auditoria de 27/08/2026
# ======================================================================
APP = os.path.join(os.path.dirname(PASTA), "autos_teste_app")

# ---- P0-3 · desconhecido não vira fato negativo -----------------------
ok(M.diagnosticar({"impossibilidade": "provada", "testemunhas": "nenhuma",
                   "contrato": "papel"}) == [],
   "R01 assinatura desconhecida não produz cenário formal")
ok(not [c for c in M.diagnosticar({"impossibilidade": "provada",
                                   "testemunhas": "duas"}) if c["letra"] == "B"],
   "R02 idem para o cenário B")
ok([c["letra"] for c in M.diagnosticar({"impossibilidade": "provada",
    "assinatura": "propria", "testemunhas": "nenhuma", "contrato": "papel"})] == ["F"],
   "R03 com assinatura afirmada, o cenário F volta a valer")

filtradas = M.filtrar_respostas({
    "assinatura": {"valor": None, "confianca": "baixa"},
    "testemunhas": {"valor": "nenhuma", "confianca": "media"},
    "conta": {"valor": "na", "confianca": "alta"},
    "contrato": {"valor": "papel", "confianca": "alta"},
})
ok("assinatura" not in filtradas, "R04 confiança baixa é descartada no filtro")
ok("conta" not in filtradas, "R05 valor não aplicável é descartado")
ok(filtradas == {"testemunhas": "nenhuma", "contrato": "papel"},
   "R06 o filtro preserva o que tem lastro", "(%s)" % filtradas)

# ---- delimitador de palavra no detector de rogo -----------------------
import re as _re
for _frase, _esperado in [
    ("ha pedido de antecipacao de tutela, liminar ou evidencia", False),
    ("nao ha pedido de justica gratuita", False),
    ("assinatura a rogo de MARIA DE JESUS", True),
    ("o rogatario assinou pela contratante", True),
    ("a rogo de", True),
    ("uma rogo qualquer", False),
    ("contratacao a pedido do cliente pelo aplicativo", False),
]:
    ok(bool(_re.search(leitor.TERMOS_ROGO, _frase)) == _esperado,
       "R36 rogo em %r" % _frase[:34], "(esperado %s)" % _esperado)
    if not _esperado:
        ok(not _re.search(leitor.ROGO_ESTRITO, _frase),
           "R37 prova positiva não dispara em %r" % _frase[:34])

# ---- P0-4 · bloqueio sem inicial ou contestação -----------------------
try:
    M.montar_peca({"documentos": [{"tipo": "contrato"}, {"tipo": "log"},
                                  {"tipo": "extrato"}]}, "A", {}, set())
    ok(False, "R07 montagem sem inicial e sem defesa é bloqueada")
except M.PreRequisitoAusente as e:
    ok(len(e.motivos) == 2, "R07 montagem sem inicial e sem defesa é bloqueada",
       "(%s)" % e.motivos)
    ok(any("inicial" in m for m in e.motivos), "R08 o motivo nomeia a inicial")
    ok(any("contestação" in m for m in e.motivos), "R09 e a contestação")
try:
    M.montar_peca({"documentos": [{"tipo": "inicial"}]}, "A", {}, set())
    ok(False, "R10 poucos documentos também bloqueiam")
except M.PreRequisitoAusente:
    ok(True, "R10 poucos documentos também bloqueiam")
ok(len(M.montar_peca({"documentos": [{"tipo": "inicial"}, {"tipo": "contestacao"},
                                     {"tipo": "contrato"}]}, "A", dados, prel)) > 60,
   "R11 com as peças presentes, monta normalmente")
ok(len(M.montar_peca({"documentos": [{"tipo": "contrato"}]}, "A", dados, prel,
                     forcar=True)) > 60, "R12 é possível forçar de forma explícita")
ok(M.prerequisitos({"documentos": []}), "R13 pasta vazia tem impedimento")
ok(M.prerequisitos(None), "R14 análise ausente tem impedimento")

# ---- P0-5 e realimentação · regressão de 0826620-35.2025 --------------
if os.path.isdir(APP):
    LA = leitor.ler_autos(leitor.coletar(APP), usar_ocr=False)
    SA = processual.analisar(LA) + forense.periciar(LA)
    codsA = {s.codigo for s in SA}
    respA = M.filtrar_respostas(LA.js()["achados"])
    candA = M.diagnosticar(respA, [s.js() for s in SA])
    letras = [c["letra"] for c in candA]

    ok(LA.achados["contratacao"].valor == "eletronica",
       "R15 contratação reconhecida como eletrônica",
       "(veio %s)" % LA.achados["contratacao"].valor)
    ok(LA.achados["contratacao"].confianca == "alta", "R16 com confiança alta")
    ok(LA.achados["contratacao"].evidencias, "R17 com o trecho que sustenta")
    ok(LA.achados["assinatura"].confianca == "baixa",
       "R18 sem rogo nos autos, a assinatura fica indeterminada")
    ok("assinatura" not in respA, "R19 e por isso não chega ao diagnóstico")

    ok(not (set(letras) & M.CENARIOS_FORMAIS),
       "R20 nenhum cenário do art. 595 é proposto", "(veio %s)" % letras)
    ok(candA[0]["letra"] == "O", "R21 o cenário eleito é o do contrato eletrônico",
       "(veio %s)" % letras)
    ok(candA[0].get("bloqueados"), "R22 os cenários retirados são informados")
    ok(all(b["letra"] in M.CENARIOS_FORMAIS for b in candA[0]["bloqueados"]),
       "R23 só cenários formais foram retirados")

    ok("IP-01" in codsA, "R24 o IP repetido foi detectado")
    reforcos = {r["codigo"] for r in candA[0].get("reforcos", [])}
    ok("IP-01" in reforcos, "R25 o IP repetido pesou na escolha do capítulo",
       "(reforços: %s)" % reforcos)
    ok(all(r.get("achado") for r in candA[0].get("reforcos", [])),
       "R26 cada reforço nomeia o achado que o produziu")

    # achado que aponta integridade não pode empurrar o cenário de defeito
    presentes = [s for s in SA if s.codigo.startswith("TRI") and s.gravidade == "nota"]
    ok(presentes, "R27 há elemento de trilha presente nestes autos")
    ok(not (reforcos & {s.codigo for s in presentes}),
       "R28 elemento presente na trilha não reforça o cenário",
       "(%s)" % (reforcos & {s.codigo for s in presentes}))

    # a peça montada precisa ser a do contrato eletrônico
    parsA = M.montar_peca(LA.js(), candA[0]["letra"], dict(LA.dados, **{
        "uf": "PI", "advogado": "X", "oab": "1", "cidade": "Teresina",
        "data": "27 de agosto de 2026"}),
        {p["cod"] for p in LA.preliminares}, conformidade=LA.conformidade69)
    txtA = "\n".join(p["t"] for p in parsA)
    ok("ELEMENTOS TÉCNICOS DO CONTRATO ELETRÔNICO" in txtA,
       "R29 a peça traz o capítulo dos elementos técnicos")
    ok("2.197.156" in txtA, "R30 e a distinção em relação ao precedente")
    ok("a rogo" not in txtA.lower(), "R31 a peça não fala em rogo")
    ok("art. 595" not in txtA and "artigo 595" not in txtA,
       "R32 nem invoca o art. 595 do Código Civil")

    # controle positivo: caso em papel com rogo real preserva os formais
    LP = leitor.ler_autos(leitor.coletar(PASTA), usar_ocr=False)
    respP = M.filtrar_respostas(LP.js()["achados"])
    candP = M.diagnosticar(respP, [s.js() for s in
                                   (processual.analisar(LP) + forense.periciar(LP))])
    ok(LP.achados["contratacao"].valor == "papel",
       "R33 rogo escrito nos autos define a contratação como em papel")
    ok(candP[0]["letra"] == "A", "R34 o controle positivo mantém o cenário formal",
       "(veio %s)" % [c["letra"] for c in candP])
    ok(not candP[0].get("bloqueados"), "R35 e nada é retirado da mesa")

shutil.rmtree(PASTA, ignore_errors=True)
shutil.rmtree(APP, ignore_errors=True)

print("=" * 62)
print("verificações: %d   falhas: %d" % (testes, len(falhas)))
for f in falhas:
    print("  FALHOU:", f)
print("=" * 62)
sys.exit(1 if falhas else 0)
