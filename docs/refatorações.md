# Plano de Implementação: Refatoração e Modularização do ForenseDoc

Este documento detalha o plano para organizar a arquitetura atual do sistema, separando responsabilidades e facilitando a manutenção e escalabilidade futura, sem perder as funcionalidades existentes.

## Necessidade de Revisão (User Review Required)

> [!IMPORTANT]  
> Por favor, revise este plano. A refatoração propõe mover bastante código para novos arquivos. Nenhuma funcionalidade ou lógica de negócio será alterada nesta fase, apenas o local onde o código reside e como ele se comunica.

## Questões em Aberto (Open Questions)

> [!WARNING]  
> 1. Você tem preferência por criar pastas `src/` no backend para abrigar o código novo ou prefere manter tudo solto na raiz do `backend/`? (A proposta atual usa `backend/src/`).
> 2. O estilo do frontend (atualmente no bloco de texto `CSS` em `ForenseDoc.jsx`) deve ser movido para um arquivo `.css` tradicional ou você prefere migrar para CSS Modules/Styled Components no futuro? (A proposta inicial é mover para `src/styles/ForenseDoc.css`).

## Alterações Propostas (Proposed Changes)

O objetivo é resolver o acoplamento de código (onde um único arquivo como `server.js` tem mais de 500 linhas e `ForenseDoc.jsx` mais de 1600).

---

### Backend (Node.js + Express)

Atualmente, rotas, lógica de PDF, Regex para extração e OCR estão todas em `server.js`. Vamos quebrar em módulos focados.

#### [NOVO] backend/src/utils/
- **stringUtils.js**: Funções de formatação de strings, normalização, capitalização, etc.
- **geoUtils.js**: Funções para construção de queries geográficas.

#### [NOVO] backend/src/services/
- **pdfService.js**: Responsável por extrair metadados e o texto inicial do PDF (`extractPdfMetadata`, `extractPdfText`).
- **ocrService.js**: Lógica isolada para interagir com o `tesseract.js` e `pdftoppm`.
- **extractionService.js**: Contém a função gigantesca `heuristicExtractionFromText` com todas as Regex de negócio.
- **apiService.js**: Lógica de comunicação com Nominatim e IPAPI (atualmente feita direto nos endpoints).

#### [NOVO] backend/src/controllers/
- **analyzeController.js**: Controlador para a rota de análise (chama os serviços de PDF, OCR e Extração).
- **geoController.js**: Controlador para as rotas de Geocodificação e IP.

#### [NOVO] backend/src/routes/
- **index.js**: Define as rotas (ex: `router.post("/analyze", analyzeController)`)

#### [MODIFICAR] backend/server.js
- Será reduzido para apenas importar o Express, configurar middlewares (`cors`, `express.json`), chamar as rotas de `src/routes/index.js` e iniciar o `.listen()`.

---

### Frontend (React + Vite)

Atualmente `ForenseDoc.jsx` detém tudo.

#### [NOVO] frontend/src/utils/
- **crypto.js**: `digestHash`, `classifyHashString`.
- **geo.js**: `haversineKm`, `riskFromDistance`.
- **api.js**: `geolocateIP`, `geocodeAddress`, `checkBackendReady`.
- **pdfExport.js**: Função complexa `exportReportPDF` e suas dependências visuais de canvas.

#### [NOVO] frontend/src/styles/
- **ForenseDoc.css**: Receberá todo o conteúdo da string `const CSS = ...`. 

#### [NOVO] frontend/src/components/
- **Row.jsx**: Componente `<Row />`.
- **Badge.jsx**: Componente `<Badge />`.
- **Section.jsx**: Componente `<Section />`.
- **DistanceBanner.jsx**: Componente `<DistanceBanner />`.
- **GeoMap.jsx**: Componente do mapa SVG `<GeoMap />`.

#### [MODIFICAR] frontend/src/ForenseDoc.jsx
- Manterá apenas a lógica de UI principal, estados (useState) e chamará os componentes e utilitários criados, ficando muito mais leve e legível.

---

## Melhorias Futuras (Análise e Sugestões)

Para implementações futuras, depois desta refatoração estrutural, recomendo avaliar os seguintes pontos:

> [!TIP]
> **Backend:**
> - **Filas (Queues) para OCR:** O uso de `tesseract.js` no próprio request HTTP pode causar lentidão se o sistema tiver vários acessos concorrentes (Timeouts). Usar `BullMQ` ou `Redis` para processamento assíncrono.
> - **Validação de Entrada:** Implementar biblioteca de schema como `Zod` para validar o Base64 do PDF e os IPs antes de tentar processar, gerando erros mais legíveis (400 Bad Request).
> - **Testes Automatizados:** Adicionar testes com `Jest` para garantir que o Regex de extração (`heuristicExtractionFromText`) não quebre com novos tipos de contratos bancários.

> [!TIP]
> **Frontend:**
> - **React Query (TanStack Query):** Ajudaria muito a lidar de forma mais moderna com os loadings, caching e falhas nas requisições da API de geolocalização e backend, melhorando a UX.
> - **Design System / UI Library:** Em vez de manter todo o CSS manual, utilizar um framework de utilitários moderno (como TailwindCSS) ou biblioteca baseada em Radix (shadcn/ui) facilitaria a manutenção de botões, modais e formulários.
> - **Upload em Lote (Batch):** Permitir o envio de múltiplos contratos de uma só vez para análise sequencial, melhorando a produtividade do escritório de advocacia.

---

## Plano de Verificação (Verification Plan)

Após eu executar a refatoração, verificarei da seguinte forma:

### Verificação Manual
1. Iniciaremos o frontend e o backend localmente.
2. Solicitarei que o usuário anexe um PDF de contrato e gere um laudo.
3. Testarei a exportação em PDF para confirmar que as quebras de página e estilos continuam idênticos ao formato atual.
4. As distâncias, dados extraídos, mapas visuais e laudos gerados não devem apresentar regressão visual ou estrutural.
