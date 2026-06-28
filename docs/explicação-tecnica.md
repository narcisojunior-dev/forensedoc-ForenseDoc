# Explicação Técnica: ForenseDoc

## Visão Geral do Sistema
O **ForenseDoc (v2.2)** é um sistema especializado na análise forense de contratos bancários de crédito consignado (INSS), desenvolvido para uso interno da Ronney Menezes Advocacia. O objetivo principal do sistema é automatizar a extração de dados, validação de assinaturas eletrônicas e análise de geolocalização (residência vs. local da assinatura/IPs) para gerar um laudo técnico fundamentado que auxilie na análise jurídica de possíveis fraudes.

A arquitetura do projeto é dividida em duas partes principais:
1. **Frontend (React + Vite):** Responsável pela interface do usuário, processamento criptográfico local (cálculo de hashes para garantir a integridade do documento original sem enviá-lo à rede de forma insegura) e geração do laudo em PDF.
2. **Backend (Node.js + Express):** Responsável por operações mais pesadas e que contornam limitações de segurança do navegador (como CORS), incluindo extração de texto de PDFs, OCR (Reconhecimento Óptico de Caracteres) de documentos escaneados, geocodificação de endereços e geolocalização de IPs.

## Módulos e Funcionalidades em Funcionamento

De acordo com o estado atual do projeto, as seguintes funcionalidades já estão implementadas e operacionais:

- **Processamento de PDF e OCR:** Extração de texto de PDFs usando `pdf-parse`. Caso o documento seja escaneado (imagem), o backend aplica OCR automaticamente (via `tesseract.js`) utilizando os modelos de linguagem locais (português/inglês).
- **Impressão Digital Criptográfica (Hashing):** Cálculo dos hashes SHA-256 e SHA-1 do arquivo PDF diretamente no navegador do usuário, garantindo a cadeia de custódia do arquivo original.
- **Extração Estruturada de Dados:** Identificação de informações chave como dados do contrato, cliente, assinatura, coordenadas GPS e IPs registrados no log do documento.
- **Geocodificação e Geolocalização:** 
  - Conversão do endereço residencial informado em coordenadas (Latitude/Longitude) utilizando a API do Nominatim.
  - Busca da localização geográfica dos endereços IP encontrados no documento (via `ipapi.co`).
- **Análise de Distância (Cálculo Haversine):** Cálculo matemático da distância entre a residência do cliente e os locais onde o documento foi assinado (GPS ou IPs), classificando o risco (baixo, moderado, alto, crítico).
- **Auditoria de Metadados:** Leitura de metadados internos do arquivo PDF (versão, autor, software produtor, datas de criação/modificação, etc.) em busca de indícios ou inconsistências.
- **Laudo Técnico e Exportação:** Geração de um laudo visual contendo fundamentação normativa automática (ex: CDC, LGPD, Lei 10.820/2003, etc.). O sistema permite exportar este laudo formatado em PDF padrão A4, com cabeçalho, paginação, modo claro de impressão e um mapa georreferenciado nativo.

## Como Executar o Projeto (Desenvolvimento)

O projeto foi configurado para rodar de forma simples e local, sem depender de chaves de API externas pagas ou serviços de IA em nuvem.

Existem duas formas de iniciar o projeto para testes e desenvolvimento:

### Opção 1: Inicialização Rápida (macOS/Linux ou Git Bash no Windows)
Na raiz do projeto (`forensedoc-handoff`), você pode usar o script de automação já preparado:

```bash
chmod +x start-dev.sh
./start-dev.sh
```
*Este script instala as dependências necessárias e sobe simultaneamente o frontend e o backend.*

### Opção 2: Inicialização Manual (Recomendado para Windows / PowerShell)
Abra dois terminais na raiz do projeto.

**Terminal 1 - Iniciando o Backend:**
```bash
cd backend
npm install
# Caso precise, você pode criar o arquivo .env a partir do .env.example
cp .env.example .env
npm run dev
```
*O backend estará rodando em `http://localhost:8787`.*
*Você pode testar se a API subiu acessando: `http://localhost:8787/api/health`*

**Terminal 2 - Iniciando o Frontend:**
```bash
cd frontend
npm install
# Caso precise, você pode criar o arquivo .env a partir do .env.example
cp .env.example .env
npm run dev
```
*O frontend estará acessível no navegador em `http://localhost:5173`.*

### Possível erro que você encontrou:
Ao tentar rodar `npm run dev:all` na raiz ou no backend, você recebeu um erro `Missing script: "dev:all"`. Isso ocorre porque não há um script unificado com esse nome no `package.json`. A forma correta é subir os dois serviços (frontend e backend) separadamente usando o `npm run dev` em cada respectiva pasta, ou utilizar o `./start-dev.sh` (caso esteja num terminal compatível com bash).
