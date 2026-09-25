# ForenseDoc — v2.2

Sistema de análise forense de contratos bancários de crédito consignado (INSS).
Ronney Menezes Advocacia — OAB/PI 15.508 · OAB/MA 26.102-A.

Este pacote é um projeto pronto para um desenvolvedor instalar, rodar e implantar. Ele separa
um **frontend** (React + Vite) de um **backend** (Node + Express). O backend existe por dois
motivos concretos, descritos em "Decisões de arquitetura".

---

## Estrutura

```
forensedoc-handoff/
├── README.md
├── .gitignore
├── backend/
│   ├── server.js          # API: /api/analyze, /api/geocode, /api/ip/:ip, /api/health
│   ├── package.json
│   └── .env.example       # PORT
│   └── ocr/lang-data      # idiomas locais do OCR (por/eng)
├── frontend/
│   ├── index.html
│   ├── vite.config.js     # proxy /api -> http://localhost:8787 (dev)
│   ├── package.json
│   ├── .env.example       # VITE_API_BASE
│   └── src/
│       ├── main.jsx
│       └── ForenseDoc.jsx # componente principal (UI + pipeline)
└── reference/
    └── ForenseDoc.sandbox.jsx   # versão original autônoma (referência, ver abaixo)
```

---

## O que o sistema faz

A partir do upload de um contrato em PDF e do endereço residencial do cliente, o ForenseDoc executa o pipeline forense:

1. **Impressão digital criptográfica** do arquivo: SHA-256 e SHA-1 calculados localmente no navegador (Web Crypto API, NIST FIPS 180-4).
2. **Extração estruturada local** dos dados do contrato, com OCR automático quando o PDF for escaneado.
3. **Confronto de hash**: compara o hash informado no documento com o hash calculado, e classifica o formato do valor declarado (detecta, por exemplo, UUID v4 se passando por hash — defeito formal).
4. **Geocodificação** do endereço residencial (referência das distâncias).
5. **Geolocalização de IP** dos endereços encontrados no log.
6. **Distância de Haversine** entre a residência e: (a) a geolocalização GPS declarada na assinatura; (b) cada IP. Classificação de risco em quatro faixas: < 50 km baixo, 50–300 km moderado, 300–1.000 km alto, > 1.000 km crítico.
7. **Mapa georreferenciado** (SVG nativo) no laudo, mostrando residência × assinatura e a distância.
8. **Cadeia de custódia** da assinatura eletrônica e veredito de validade.
9. **Fundamentação normativa** aplicável, amarrada aos achados.
10. **Auditoria de metadados internos**: versão PDF, autor, produtor, datas, páginas, formulários, criptografia, assinatura digital incorporada e alertas de consistência.
11. **Exportação em PDF** do laudo, com paginação protegida e folha exclusiva para o conjunto geográfico.
12. **Datas internas confrontadas** (22/09/2026): ModDate anterior ao CreationDate (INT3), PDF gerado no instante do aceite ou da biometria (INT4), linhagem de template de editor de texto.
13. **Inventário de imagens sem Poppler**: objetos de imagem lidos do próprio arquivo, com hash do fluxo bruto e EXIF, quando o `pdfimages` falta; e **reúso da mesma fotografia** em outro dossiê do mesmo escritório (IMG6).
14. **Aparelho, navegador e faixa do IP**: modelo e user agent no § 4.2, navegador defasado para a data do ato (DEV2), natureza da rede (operadora, provedor regional, hospedagem, VPN) no § 5.3.
15. **Grau e âncora de cada achado** no § 6: constatado no arquivo, não verificável pelo arquivo, indício; página e trecho de origem. Ver `docs/pericia-seis-camadas-2026-09-22.md`.
19. **Regimes de autorização do consignado INSS** (25/09/2026): enquadramento pela data do contrato (IN 28/2008, IN 138/2022, Meu INSS, IN 213/2026), evidências do Meu INSS e da conta gov.br, achados INS0 a INS11, seção "Autorização do benefício (INSS)", quesitos ao INSS e à Dataprev. Marcos e dispositivos não conferidos no DOU saem com ressalva e sem número de artigo (`engine/regimeInss.js`); INS2 só vira achado depois da conferência. Ciclo de validação com 9 dossiês reais: fonte pagadora decide o produto, IMG2 por folha, ícones não são imagem documental. Ver `docs/pericia-seis-camadas-2026-09-22.md`.
18. **Terceira rodada** (25/09/2026): imagem só é biometria se tiver tom de pele (a arte do cartão Credcesta virava IMG2 e IMG6 críticos); cidade e UF do cliente não vêm mais da cláusula de sede do credor; rótulos em sequência ("Bairro: Cidade: Estado:") não viram valor.
17. **Segunda rodada da perícia** (22/09/2026, noite): IMG6 não acusa a mesma cópia do documento nem outra cópia do mesmo contrato; quesito de divergência geográfica só quando o § 5 divergiu; placar de graus do sumário recontado depois dos cortes; lista de ferramental restrita ao que o sistema usa.
16. **Referência residencial em nível de município**: CEP genérico resolve na sede do município, e ponto do ato no mesmo município da referência não recebe distância residencial (o confronto passa a ser de município).

---

## Decisões de arquitetura (por que existe um backend)

O componente foi originalmente desenvolvido e validado como artefato de página única. Para produção, chamadas externas e processamento pesado foram movidos para o backend:

1. **Extração local do PDF com OCR.** O endpoint `POST /api/analyze` recebe o PDF em base64, lê o texto pesquisável e, se necessário, renderiza as páginas para OCR local (`tesseract.js` + idiomas `por/eng`). Não há chave externa nem chamada a modelo externo.
2. **Geocodificação (Nominatim) e geolocalização de IP (ipapi.co).** Em navegador essas chamadas sofrem bloqueio de CORS/CSP. No servidor não há esse problema, e o Nominatim ganha precisão de rua. Endpoints: `GET /api/geocode?q=...` e `GET /api/ip/:ip`.

O frontend chama esses três endpoints via `API_BASE` (variável `VITE_API_BASE`). Em desenvolvimento, `API_BASE` fica vazio e o proxy do Vite encaminha `/api` ao backend.

> A pasta `reference/ForenseDoc.sandbox.jsx` contém a versão autônoma original. Serve apenas como referência histórica de comportamento; **não** use em produção.

---

## Pré-requisitos

- Node.js **18 ou superior** (o backend usa `fetch` nativo).
- Nenhuma chave externa é necessária para a análise local.

---

## Como rodar (desenvolvimento)

### Opção rápida no macOS/Linux

```bash
cd forensedoc-handoff
chmod +x start-dev.sh
./start-dev.sh
```

O script instala dependências, cria `backend/.env` se ainda não existir e sobe backend + frontend.
O sistema funciona em modo local. Em PDFs escaneados, o backend aplica OCR automaticamente nas primeiras páginas configuradas.

---

Abra dois terminais.

**Backend:**
```bash
cd backend
cp .env.example .env        # opcional; use apenas se quiser alterar PORT
npm install
npm run dev                 # sobe em http://localhost:8787
```

**Frontend:**
```bash
cd frontend
cp .env.example .env        # pode deixar VITE_API_BASE vazio em dev
npm install
npm run dev                 # abre em http://localhost:5173
```

Acesse o frontend, informe o endereço residencial, anexe o PDF e gere o laudo.

### Diagnóstico rápido

- Se a tela avisar que o backend não está respondendo, inicie `backend` em `http://localhost:8787`.
- O sistema aplica OCR local em documentos escaneados. Se o PDF for muito longo, ajuste `OCR_MAX_PAGES` no `backend/.env`.
- Confira o backend em: `http://localhost:8787/api/health`. O campo `analyzer` deve mostrar `pdf-text+ocr`.
- O botão de PDF gera o arquivo automaticamente e também exibe um link de download manual caso o navegador bloqueie o download automático.

---

## Build e implantação (produção)

**Frontend:**
```bash
cd frontend
# defina VITE_API_BASE com a URL pública do backend antes do build:
echo "VITE_API_BASE=https://api.seudominio.com.br" > .env
npm install && npm run build   # gera dist/
```
Sirva o conteúdo de `dist/` por um CDN ou servidor estático (Nginx, Vercel, etc.).

**Backend:**
```bash
cd backend
npm install
PORT=8787 npm start
```
Coloque o backend atrás de HTTPS. Restrinja o CORS ao domínio do frontend em produção
(no `server.js`, troque `app.use(cors())` por `app.use(cors({ origin: "https://seudominio.com.br" }))`).

---

## Endpoints do backend

| Método | Rota | Corpo / Parâmetro | Retorno |
|---|---|---|---|
| POST | `/api/analyze` | `{ pdfBase64 }` | `{ text, metadata, usedOcr, ocrPages, warning }` |
| GET | `/api/geocode` | `?q=endereço` | `{ lat, lon, display }` ou `null` |
| GET | `/api/ip/:ip` | IP na rota | `{ city, region, country, lat, lon, isp, timezone }` ou `null` |
| GET | `/api/health` | — | `{ ok, mode, analyzer }` |

---

## Fundamentação legal embutida no laudo (§ 9)

- **Consumo / informação:** CDC (Lei 8.078/1990), arts. 6º III, 46, 52, 51 IV e §1º; Súmula 297 do STJ.
- **Consignado / INSS:** Lei 10.820/2003; Decreto 4.840/2003; Lei 8.213/1991, art. 115; normas do INSS (Instrução Normativa vigente) e Resoluções do CNPS.
- **CET:** Resolução CMN 4.881/2020, arts. 2º e 7º (revogou a Resolução 3.517/2007).
- **Assinatura eletrônica / prova:** MP 2.200-2/2001, art. 10 §2º; Lei 14.063/2020; STJ REsp 2.159.442 e REsp 2.205.708; Tema 1.061 com CPC art. 373.
- **Vícios / boa-fé:** CC arts. 138, 145, 157 e 422; superendividamento (Lei 14.181/2021); Súmula 479 do STJ.
- **Proteção de dados:** LGPD (Lei 13.709/2018), arts. 5º e 7º.

A tese central de assinatura: a ausência de certificação ICP-Brasil não é, por si só, vício; o que valida a assinatura é a **completude da cadeia de custódia**. Impugnada a assinatura, o ônus da prova da autenticidade é da instituição (Tema 1.061).

---

## Notas técnicas para o desenvolvedor

- **Hash:** calculado no cliente (Web Crypto). Não mover para o servidor — a impressão digital deve refletir o arquivo original recebido do usuário.
- **Extração resiliente:** `parseExtraction` tenta JSON direto e, se falhar, recorta o trecho entre a primeira e a última chave. Se ainda assim falhar, o laudo é gerado parcialmente, com aviso, em vez de quebrar.
- **Exportação PDF:** usa `html2canvas` + `jspdf` como dependências do frontend, carregadas sob demanda no clique do botão. Durante a captura, o relatório entra em modo claro para gerar um PDF mais adequado a protocolo/impressão, sem depender de CDN externo.
- **Nominatim:** respeite a política de uso (User-Agent já definido, limite ~1 req/s). Para volume, considere um provedor próprio (Photon, instância própria do Nominatim ou Google Geocoding).
- **Margem de erro:** geolocalização de IP e geocodificação têm imprecisão inerente; o laudo já registra isso. A distância geográfica, isoladamente, não é prova de fraude.

---

## Licença / uso

Uso interno de Ronney Menezes Advocacia. O laudo gerado é de apoio à análise jurídica e deve ser
revisado por profissional habilitado antes de uso como prova nos autos.
