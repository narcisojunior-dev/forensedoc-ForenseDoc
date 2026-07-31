import LegalLayout, { Secao, Destaque, Tabela, FIRM } from "./LegalLayout.jsx";

/**
 * Termos de Uso.
 *
 * A seção que mais importa aqui é a 4: dizer com clareza o que o laudo É e o que
 * ele NÃO é. Um laudo automatizado apresentado como prova pericial definitiva
 * cria expectativa que o produto não sustenta, e a frustração dessa expectativa
 * é problema do fornecedor, não do cliente (CDC, art. 30).
 */
export default function Termos() {
  return (
    <LegalLayout
      titulo="Termos de Uso"
      resumo={
        <>
          <p>
            O {FIRM.sistema} analisa contratos de crédito consignado e produz um laudo técnico de
            apoio. O laudo é <strong>peça de análise preliminar</strong>, não substitui perícia
            judicial nem constitui parecer jurídico.
          </p>
          <p>
            Você paga por análise, através de créditos. Pode cancelar quando quiser, e tem 7 dias de
            arrependimento garantidos por lei.
          </p>
        </>
      }
    >
      <Secao numero="1" titulo="Quem somos e o que estes termos regem">
        <p>
          O {FIRM.sistema} é um sistema de {FIRM.nome} ({FIRM.oab}). Estes termos regem o uso da
          plataforma e formam contrato entre você, ou o escritório que você representa, e nós.
        </p>
        <p>Ao criar uma conta, você declara ter lido e aceito estes termos.</p>
      </Secao>

      <Secao numero="2" titulo="O que o serviço faz">
        <p>
          A plataforma recebe um documento em PDF, extrai dele informações de forma automatizada e
          produz um laudo técnico contendo:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>Resumos criptográficos (SHA-256 e SHA-1) do arquivo analisado.</li>
          <li>Dados do contrato e do contratante identificados no documento.</li>
          <li>Avaliação da cadeia de custódia do ato de assinatura eletrônica.</li>
          <li>
            Confronto geográfico entre a residência informada, a geolocalização declarada no
            documento e a origem da conexão pelo endereço IP.
          </li>
          <li>Fundamentação normativa aplicável.</li>
        </ul>
      </Secao>

      <Secao numero="3" titulo="Conta, planos e créditos">
        <p>
          Cada análise consome um crédito. Créditos vêm da assinatura mensal ou de compra avulsa, e
          os mensais expiram ao fim do ciclo de faturamento.
        </p>
        <p>
          Se uma análise falhar por erro do sistema, o crédito é estornado automaticamente. Falha
          por documento ilegível, corrompido ou fora do formato aceito também gera estorno.
        </p>
        <p>
          Cada plano define quantas análises podem ser processadas ao mesmo tempo e quantas podem
          ser iniciadas por minuto. Esses limites constam da página de planos e existem para que o
          uso intenso de um cliente não degrade o serviço dos demais.
        </p>
        <p>
          Você é responsável por manter suas credenciais em sigilo e por toda atividade realizada na
          sua conta. Avise-nos imediatamente se suspeitar de acesso indevido.
        </p>
      </Secao>

      <Secao numero="4" titulo="O que o laudo é, e o que não é">
        <Destaque tom="alerta">
          <p>
            O laudo é produzido por <strong>extração automatizada</strong> do texto do documento.
            Ele é instrumento de apoio à análise jurídica, e depende de conferência humana antes de
            qualquer uso.
          </p>
        </Destaque>
        <p>
          <strong>O laudo não é:</strong>
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            perícia judicial, que só pode ser produzida por perito nomeado pelo juízo, na forma dos
            arts. 464 e seguintes do Código de Processo Civil;
          </li>
          <li>parecer jurídico ou recomendação sobre a viabilidade de uma ação;</li>
          <li>prova de fraude. Divergências apontadas são indícios que exigem contextualização.</li>
        </ul>
        <p>
          O sistema informa no próprio laudo a origem de cada dado e as limitações de cada método.
          A geolocalização por endereço IP, por exemplo, indica o ponto de presença da operadora, e
          não a posição do aparelho, com margem que pode chegar a dezenas de quilômetros.
        </p>
        <p>
          A qualidade do resultado depende da qualidade do documento enviado. Documento digitalizado
          com baixa resolução, incompleto ou com camada de texto ausente produz extração parcial, e
          o laudo declara expressamente o que não pôde ser apurado.
        </p>
      </Secao>

      <Secao numero="5" titulo="Uso aceitável">
        <p>Ao usar a plataforma, você se compromete a:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            enviar apenas documentos que você tenha fundamento legítimo para tratar, seja como
            representante do titular, seja no exercício regular de direito em processo;
          </li>
          <li>não tentar contornar limites técnicos, de plano ou de segurança;</li>
          <li>
            não usar o serviço para finalidade ilícita, nem para produzir peça que você saiba ser
            enganosa;
          </li>
          <li>não compartilhar credenciais com quem não seja usuário autorizado da sua conta.</li>
        </ul>
        <p>
          O descumprimento pode levar à suspensão da conta. Em caso de suspensão por violação, os
          créditos não utilizados não são restituídos.
        </p>
      </Secao>

      <Secao numero="6" titulo="Pagamento, cancelamento e arrependimento">
        <Tabela
          cabecalho={["Situação", "Como funciona"]}
          linhas={[
            [
              "Arrependimento",
              "7 dias corridos a contar da contratação, com devolução integral (CDC, art. 49)",
            ],
            [
              "Cancelamento da assinatura",
              "A qualquer tempo. O acesso permanece até o fim do ciclo já pago",
            ],
            ["Atraso no pagamento", "Aviso em 3 dias e suspensão no 7º dia de atraso"],
            ["Créditos avulsos", "Não expiram enquanto a conta estiver ativa"],
          ]}
        />
        <p>
          Os pagamentos são processados por instituição de pagamento contratada, e não armazenamos
          dados de cartão em nossos servidores.
        </p>
      </Secao>

      <Secao numero="7" titulo="Disponibilidade e limites de responsabilidade">
        <p>
          Empenhamo-nos para manter o serviço disponível, mas ele pode ser interrompido por
          manutenção, falha de terceiros de que dependemos ou caso fortuito.
        </p>
        <p>
          Nossa responsabilidade limita-se ao valor pago por você nos 12 meses anteriores ao evento.
          Não respondemos por decisão processual tomada com base no laudo sem a conferência humana
          prevista na seção 4, nem por lucros cessantes.
        </p>
        <p>
          Nada nesta seção afasta direitos que o Código de Defesa do Consumidor assegure de forma
          irrenunciável.
        </p>
      </Secao>

      <Secao numero="8" titulo="Propriedade e conteúdo">
        <p>
          O sistema, sua identidade visual e o método de análise pertencem a {FIRM.nome}. Os
          documentos que você envia e os laudos deles resultantes pertencem a você, e não os
          utilizamos para qualquer finalidade além de prestar o serviço contratado.
        </p>
      </Secao>

      <Secao numero="9" titulo="Alterações e encerramento">
        <p>
          Estes termos podem ser alterados. Mudanças relevantes serão comunicadas por e-mail e pela
          plataforma com antecedência de 30 dias. Se você não concordar, pode cancelar antes da
          vigência, com devolução proporcional do período pago e não usufruído.
        </p>
        <p>
          Você pode encerrar sua conta quando quiser. O tratamento dos dados após o encerramento
          segue os prazos da Política de Privacidade.
        </p>
      </Secao>

      <Secao numero="10" titulo="Foro">
        <p>
          Aplica-se a lei brasileira. Fica eleito o foro do domicílio do consumidor para dirimir
          controvérsias, conforme o Código de Defesa do Consumidor.
        </p>
      </Secao>
    </LegalLayout>
  );
}
