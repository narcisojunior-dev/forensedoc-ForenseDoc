import LegalLayout, { Secao, Destaque, Tabela, FIRM, QUALIFICACAO } from "./LegalLayout.jsx";

/**
 * Política de Privacidade.
 *
 * O conteúdo descreve o que o sistema REALMENTE faz, e não um texto genérico:
 * os prazos são os que as rotinas de expurgo aplicam, os sub-operadores são os
 * serviços de fato consultados, e a lista de dados corresponde ao que é
 * extraído e persistido.
 *
 * Uma política que promete o que o sistema não cumpre é pior que não ter
 * política: vira prova documental contra quem a publicou.
 */
export default function Privacidade() {
  return (
    <LegalLayout
      titulo="Política de Privacidade"
      resumo={
        <>
          <p>
            O {FIRM.sistema} analisa contratos que você envia e produz um laudo técnico. Para isso,
            trata dados seus (de cadastro) e dados de terceiros que constam dos documentos enviados.
          </p>
          <p>
            O documento original é apagado em <strong>30 dias</strong>. O laudo permanece enquanto
            durar o seu contrato conosco.
          </p>
        </>
      }
    >
      <Secao numero="1" titulo="Dois papéis diferentes, e por que isso importa">
        <p>
          Esta política trata de duas relações distintas, com responsabilidades diferentes sob a Lei
          Geral de Proteção de Dados (Lei 13.709/2018).
        </p>
        <Tabela
          cabecalho={["Situação", "Quem decide", "Nosso papel"]}
          linhas={[
            [
              "Seus dados de cadastro e uso da plataforma",
              // Quem responde como controlador é a empresa, não o produto.
              `${FIRM.nome}, titular do ${FIRM.sistema}`,
              "Controlador (art. 5º, VI)",
            ],
            [
              "Dados de terceiros nos documentos que você envia",
              "Você, ou o escritório assinante",
              "Operador (art. 5º, VII)",
            ],
          ]}
        />
        <p>
          Na segunda situação, quem define a finalidade do tratamento é você: nós apenas executamos
          a análise que você solicitou, seguindo as suas instruções. Se o titular dos dados
          constantes do contrato analisado procurar você, a resposta cabe a você, e nós apoiamos com
          o que estiver sob nossa guarda.
        </p>
      </Secao>

      <Secao numero="2" titulo="Que dados tratamos">
        <p>
          <strong>Dados que você fornece ao se cadastrar:</strong> nome, e-mail, senha (armazenada
          apenas como resumo criptográfico, nunca em texto), e os dados de faturamento necessários à
          assinatura.
        </p>
        <p>
          <strong>Dados gerados pelo seu uso:</strong> endereço IP, identificação do navegador,
          data e hora das ações relevantes (entrar, sair, iniciar análise, movimentar créditos).
          Esse registro existe para segurança e para permitir apurar acesso indevido.
        </p>
        <p>
          <strong>Dados contidos nos documentos que você envia:</strong> o sistema extrai do PDF, de
          forma automatizada, informações como nome e CPF do contratante, endereço, dados do
          contrato, endereço IP registrado no ato da assinatura, coordenadas de geolocalização,
          data e hora, e resumos criptográficos do arquivo.
        </p>
        <Destaque tom="alerta">
          <p>
            <strong>Esses dados costumam ser de pessoas que não são nossos clientes</strong> e que
            nunca interagiram conosco. É por isso que o documento original tem prazo de guarda curto
            e que o envio depende de você ter base legal para tratá-lo, como explicado na seção 6.
          </p>
        </Destaque>
      </Secao>

      <Secao numero="3" titulo="Por quanto tempo guardamos">
        <p>
          Os prazos abaixo são aplicados automaticamente por rotinas do sistema, que registram a
          data em que cada eliminação ocorreu.
        </p>
        <Tabela
          cabecalho={["O quê", "Prazo", "Por quê"]}
          linhas={[
            [
              "Documento original enviado",
              "30 dias",
              "A finalidade se esgota quando o laudo é emitido (art. 15, I). A janela existe para reprocessar a análise e responder a contestação",
            ],
            [
              "Laudo produzido",
              "Enquanto durar o contrato",
              "É o produto que você contratou e a prova do serviço prestado",
            ],
            [
              "Registros de acesso e auditoria",
              "12 meses",
              "Segurança e apuração. O Marco Civil da Internet (art. 15) exige no mínimo 6 meses",
            ],
            ["Notificações já lidas", "6 meses", "Cumprida a função de avisar, perdem utilidade"],
            [
              "Dados de cadastro e faturamento",
              "Enquanto durar o contrato, e depois pelo prazo legal",
              "Obrigações fiscais e defesa em eventual processo (art. 16, I e III)",
            ],
          ]}
        />
        <Destaque>
          <p>
            <strong>Apagar o documento original não enfraquece o laudo.</strong> O laudo preserva os
            resumos criptográficos SHA-256 e SHA-1 do arquivo analisado. Se o mesmo documento for
            apresentado depois, esses resumos demonstram que se trata do arquivo idêntico ao que foi
            examinado.
          </p>
        </Destaque>
      </Secao>

      <Secao numero="4" titulo="Com quem os dados são compartilhados">
        <p>
          Não vendemos dados nem os usamos para publicidade. O compartilhamento se limita ao que é
          necessário para o serviço funcionar:
        </p>
        <Tabela
          cabecalho={["Serviço", "O que recebe", "Para quê"]}
          linhas={[
            ["Asaas", "Nome, e-mail e dados de cobrança", "Processar pagamentos e assinaturas"],
            [
              "Serviço de geocodificação",
              "Endereço textual a ser convertido em coordenadas",
              "Localizar no mapa o endereço informado ou extraído",
            ],
            [
              "Serviço de geolocalização de IP",
              "Endereço IP extraído do documento",
              "Estimar a região de origem da conexão",
            ],
            [
              "Serviço de mapas",
              "Coordenadas geográficas",
              "Gerar as imagens de mapa que ilustram o laudo",
            ],
            ["Provedor de e-mail", "E-mail e conteúdo da mensagem", "Enviar avisos transacionais"],
          ]}
        />
        <Destaque tom="alerta">
          <p>
            <strong>Transferência internacional.</strong> Os documentos enviados são armazenados em
            servidor no Brasil. Contudo, os serviços de geocodificação, de geolocalização de IP e de
            mapas são operados no exterior, e para eles são enviados endereços, endereços IP e
            coordenadas, que são dados pessoais. Essas transferências ocorrem com fundamento no
            art. 33, IX da LGPD, por serem necessárias à execução do contrato firmado com você. Não
            enviamos a esses serviços nome, CPF ou o conteúdo do documento.
          </p>
        </Destaque>
        <p>
          Também poderemos compartilhar dados mediante ordem judicial ou requisição de autoridade
          competente, hipótese em que você será informado sempre que a lei permitir.
        </p>
      </Secao>

      <Secao numero="5" titulo="Como protegemos">
        <p>Entre as medidas técnicas adotadas:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>Tráfego cifrado por TLS em todas as comunicações.</li>
          <li>Senhas armazenadas apenas como resumo criptográfico com sal, jamais em texto.</li>
          <li>
            Isolamento entre clientes: cada conta acessa exclusivamente os próprios documentos e
            laudos, verificado em todas as rotas do sistema.
          </li>
          <li>Sessões com expiração curta e renovação por token rotativo.</li>
          <li>Limites de requisição e bloqueio temporário após tentativas seguidas de acesso.</li>
          <li>Painel administrativo restrito a endereços de rede previamente autorizados.</li>
          <li>Registro de auditoria das ações relevantes, com endereço IP e data e hora.</li>
        </ul>
        <p>
          Nenhuma medida elimina risco por completo. Em caso de incidente de segurança que possa
          acarretar risco relevante, comunicaremos você e a Autoridade Nacional de Proteção de Dados
          nos termos do art. 48 da LGPD.
        </p>
      </Secao>

      <Secao numero="6" titulo="Sua responsabilidade ao enviar documentos">
        <p>
          Ao enviar um contrato, você declara ter fundamento legítimo para tratar os dados pessoais
          nele contidos, seja porque representa o titular, seja porque exerce regularmente direito
          em processo (art. 7º, VI e IX da LGPD).
        </p>
        <p>
          Não temos como verificar essa condição, e ela permanece sob sua responsabilidade. Enviar
          documento de terceiro sem fundamento adequado expõe você, e não a plataforma, às
          consequências previstas na legislação.
        </p>
      </Secao>

      <Secao numero="7" titulo="Seus direitos">
        <p>
          O art. 18 da LGPD assegura a você, quanto aos dados de que somos controladores,
          confirmação da existência de tratamento, acesso, correção, anonimização, portabilidade,
          eliminação, informação sobre compartilhamento e revogação do consentimento. O controlador
          é {QUALIFICACAO}.
        </p>
        <p>
          Para exercer qualquer deles, escreva para{" "}
          <a href="mailto:contato@forensedoc.com.br" className="text-primary hover:underline">
            contato@forensedoc.com.br
          </a>
          . Responderemos em até 15 dias.
        </p>
        <p>
          Você pode solicitar a eliminação de um documento enviado <strong>antes</strong> do prazo
          de 30 dias. Alguns dados permanecem mesmo após pedido de eliminação, quando houver
          obrigação legal de guarda ou necessidade de exercício regular de direito, hipóteses
          previstas no art. 16 da LGPD.
        </p>
        <Destaque>
          <p>
            Se você é titular de dados que constam de um documento analisado por um escritório
            usuário desta plataforma, o pedido deve ser dirigido a esse escritório, que é quem
            decide sobre aquele tratamento. Encaminhe a nós apenas se não conseguir identificá-lo, e
            nós faremos a ponte.
          </p>
        </Destaque>
      </Secao>

      <Secao numero="8" titulo="Verificação pública de laudo">
        <p>
          Cada laudo emitido recebe um código de verificação e um resumo criptográfico SHA-256 do
          seu conteúdo, impressos no documento junto de um QR Code. Qualquer pessoa pode consultar
          esse código em nossa página de verificação, sem cadastro, para confirmar que o laudo em
          mãos foi realmente emitido por nós e não foi alterado.
        </p>
        <p>
          A consulta exibe a situação do laudo, a data de emissão, os resumos criptográficos e o
          nome e o CPF do titular <strong>parcialmente ocultos</strong>. O mascaramento é aplicado
          no momento da emissão e gravado assim: a página não tem acesso ao dado completo. Exibimos
          o mínimo necessário para que quem já tem o laudo confirme que se trata do mesmo documento,
          sem revelar a identidade a quem não a conhece (art. 6º, III). A página não informa o
          resultado da perícia: autenticidade e conteúdo são perguntas distintas, e só a primeira é
          pública.
        </p>
        <p>
          O código de verificação tem entropia suficiente para não ser adivinhado, e a consulta é
          limitada por origem. Registramos cada consulta em nossa trilha de auditoria, com o
          endereço IP, pelo prazo de 12 meses, para identificar tentativas de varredura.
        </p>
        <p>
          Atendido o pedido de eliminação do titular, os dados pessoais saem do registro de
          verificação e a página passa a exibir apenas os resumos criptográficos e a confirmação de
          que o laudo foi emitido. Os resumos permanecem porque não identificam ninguém isoladamente
          e são o que permite a quem recebeu o documento continuar conferindo sua integridade.
        </p>
      </Secao>

      <Secao numero="9" titulo="Cookies">
        <p>
          Utilizamos apenas armazenamento estritamente necessário ao funcionamento: um cookie de
          sessão que mantém você conectado. Ele é restrito ao nosso domínio, inacessível a scripts e
          transmitido somente por conexão segura.
        </p>
        <p>Não utilizamos cookies de publicidade nem de rastreamento de terceiros.</p>
      </Secao>

      <Secao numero="10" titulo="Alterações">
        <p>
          Esta política pode ser atualizada para refletir mudanças no serviço ou na legislação.
          Alterações relevantes serão comunicadas por e-mail e pela plataforma, com antecedência
          razoável. A data de vigência no topo indica a versão atual.
        </p>
      </Secao>
    </LegalLayout>
  );
}
