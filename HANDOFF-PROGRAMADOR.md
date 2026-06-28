# ForenseDoc - Handoff para desenvolvimento

## Estado atual

O projeto roda localmente sem Anthropic, OpenAI ou outra API de IA. A extração utiliza
`pdf-parse`; documentos escaneados recebem OCR local com `tesseract.js` e os modelos
português/inglês incluídos em `backend/ocr/lang-data`.

## Funcionalidades concluídas

- Extração de texto e OCR automático em PDFs escaneados.
- Hashes SHA-256 e SHA-1 calculados no navegador.
- Extração estruturada de contrato, cliente, assinatura, GPS e IPs.
- Geocodificação de endereço com variações de busca via Nominatim.
- Cálculo Haversine entre residência, assinatura e IPs.
- Auditoria de metadados internos do PDF.
- Laudo completo com fundamentação normativa.
- Exportação A4 com cabeçalho, rodapé, páginas numeradas e geolocalização em folha exclusiva.

## Testes executados

- `npm run build` no frontend: aprovado.
- `node --check backend/server.js`: aprovado.
- `POST /api/analyze` com contrato escaneado de duas páginas: HTTP 200 e OCR nas duas páginas.
- Metadados detectados no arquivo de teste: PDF 1.7, A4, duas páginas, autor, produtor,
  datas internas, identificador de trailer e ausência de assinatura digital incorporada.
- PDFs anteriores foram renderizados página por página para localizar e corrigir a quebra
  do mapa de geolocalização.

## Execução

```bash
chmod +x start-dev.sh
./start-dev.sh
```

Frontend: `http://127.0.0.1:5173/`

Backend: `http://localhost:8787/`

Saúde da API: `http://localhost:8787/api/health`

## Arquivos principais

- `frontend/src/ForenseDoc.jsx`: interface, análise no cliente e exportação PDF.
- `backend/server.js`: OCR, extração, metadados, geocodificação e IP.
- `frontend/vite.config.js`: proxy local de `/api` para o backend.
- `backend/.env.example`: configuração de porta, idioma, DPI e limite de páginas do OCR.

## Pontos para produção

- Restringir CORS ao domínio oficial.
- Colocar o backend atrás de HTTPS e limitar tamanho/frequência dos uploads.
- Definir política de retenção: atualmente o PDF é processado em memória e arquivos
  temporários de OCR são removidos ao final.
- Para alto volume, usar fila de processamento e serviço próprio/licenciado de geocodificação.
- Revisar as normas jurídicas embutidas sempre que houver atualização legislativa.
- Adicionar testes automatizados de regressão visual para o PDF em diferentes quantidades
  de campos, IPs e evidências.

## Observação sobre metadados

Metadados são declarativos e editáveis. O laudo os trata como indícios, sem confundi-los
com o hash criptográfico do arquivo ou com uma assinatura digital incorporada.
