/**
 * Gerador de Quesitos Periciais Judiciais Prontos.
 * Permite que o advogado anexe diretamente à Petição Inicial ou Impugnação à Contestação,
 * fixando os pontos controvertidos para o Perito Judicial e intimando a instituição financeira.
 */

export function generateJudicialQuesitos({
  clienteNome,
  clienteCpf,
  contratoNumero,
  banco,
  ip,
  porta,
  gpsCoords,
  cidadeIp,
  cidadeDomicilio,
  distanciaKm,
  dataHora,
}) {
  const nomeRef = clienteNome || "da parte Autora";
  const cpfRef = clienteCpf ? `inscrito(a) no CPF nº ${clienteCpf}` : "";
  const bancoRef = banco || "a Instituição Financeira";
  const contratoRef = contratoNumero ? `vinculado à proposta/contrato nº ${contratoNumero}` : "";
  const ipRef = ip ? `endereço IP ${ip}${porta ? ` (porta lógica: ${porta})` : ""}` : "endereço IP";
  const dataRef = dataHora || "na data e hora registradas no dossiê";

  return [
    {
      numero: 1,
      titulo: "Identificação e Registro Integral da Conexão (Marco Civil da Internet)",
      quesito: `Queira o Sr. Perito ou ${bancoRef} apresentar o relatório de conexão integral referente à operação ${contratoRef}, informando detalhadamente o endereço IP completo, a porta lógica de origem, o fuso horário (com indicação UTC) e os registros de cabeçalho da sessão, nos termos do art. 10 e art. 15 da Lei nº 12.965/2014 (Marco Civil da Internet).`,
      finalidade: "Exigir a cadeia técnica sem omissão de porta lógica ou masquerading.",
    },
    {
      numero: 2,
      titulo: "Esclarecimento sobre a Divergência Geográfica",
      quesito: `Considerando que o dossiê acostado aos autos aponta conexão realizada a partir de ${cidadeIp || "região remota"} (${ipRef}) e coordenadas de GPS em ${gpsCoords || "localidade diversa"}, enquanto o domicílio de ${nomeRef} situa-se em ${cidadeDomicilio || "outro estado/município"} — distando aproximadamente ${distanciaKm ? `${distanciaKm} km` : "milhares de quilômetros"} —, queira esclarecer se há elementos técnicos que justifiquem ou comprovem a presença física do titular no local registrado no instante da assinatura (${dataRef}).`,
      finalidade: "Consolidar a incompatibilidade espacial e o afastamento da tese de contratação presencial/regular.",
    },
    {
      numero: 3,
      titulo: "Autenticação em Fatores Múltiplos e Destinatário de Token (SMS / WhatsApp)",
      quesito: `Caso a contratação tenha utilizado autenticação secundária (como envio de código SMS ou token via WhatsApp), queira ${bancoRef} comprovar documentalmente a linha telefônica exata (número de telefone e operadora) que recebeu o código, demonstrando se referida linha pertencia de fato à titularidade de ${nomeRef} na data da operação.`,
      finalidade: "Demonstrar eventuais fraudes por SIM Swap, número falso ou intermediário ilícito.",
    },
    {
      numero: 4,
      titulo: "Validação Biométrica e Prova de Vida Ativa (Liveness Detection)",
      quesito: `Queira o Sr. Perito informar se os registros biométricos apresentados nos autos contêm comprovação de 'Prova de Vida' ativa (Liveness Detection) com desafio dinâmico no momento da captura da imagem, ou se tratou de mera foto estática ou upload de imagem prévia passível de injeção digital ou deepfake.`,
      finalidade: "Neutralizar biometrias estáticas fraudadas ou extraídas de documentos vazados.",
    },
    {
      numero: 5,
      titulo: "Integridade Criptográfica e Ônus Probatório (Tema 1.061 STJ e MP 2.200-2/2001)",
      quesito: `Diante da expressa impugnação de autenticidade formulada pelo consumidor (CPC, art. 429, II c/c Tema 1.061 do STJ), queira informar se a assinatura eletrônica utilizada possui certificado emitido sob a infraestrutura ICP-Brasil (assinatura qualificada) ou se depende exclusivamente de meios eletrônicos avançados/simples, especificando se o código hash do contrato original permaneceu inalterado desde a contratação.`,
      finalidade: "Fixar a incumbência probatória sobre a instituição financeira requerida.",
    },
  ];
}
