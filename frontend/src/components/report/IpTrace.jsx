import React from "react";
import { Globe, AlertTriangle } from "lucide-react";
import { Row, Badge, Note, TONES } from "../UiComponents.jsx";
import { GeoMap } from "../GeoMap.jsx";

/**
 * § 6 — rastro de conexão por endereço IP.
 *
 * A versão anterior mostrava "IP #1 · <endereço>" e duas distâncias em km,
 * deixando a interpretação por conta de quem lia. Faltava o que dá valor
 * probatório ao dado: o rótulo com que o assinador registrou o endereço, a
 * versão do protocolo, a porta lógica, a data/hora, o provedor consultado e a
 * leitura pericial da divergência.
 *
 * A classificação (`divergenciaResidencia` / `divergenciaAssinatura`) vem do
 * servidor — `backend/src/utils/geoDivergence.js` —, para a tela e o PDF não
 * discordarem sobre o mesmo laudo.
 */
function Divergencia({ titulo, d }) {
  if (!d) return null;
  const tom = TONES[d.tom] || TONES.neutral;

  return (
    <div
      data-report-block
      className={`mt-2.5 rounded-lg border px-4 py-3 ${tom.bg}`}
      style={{ borderColor: `${tom.hex}55` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-zinc-400">{titulo}</span>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold tabular-nums" style={{ color: tom.hex }}>
            {d.km.toFixed(2)} km
          </span>
          <Badge label={d.rotulo} tone={d.tom} />
        </div>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-300">{d.sintese}</p>
      {d.ressalva && <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">{d.ressalva}</p>}
    </div>
  );
}

export default function IpTrace({ ipAnalysis, homeGeo }) {
  return (
    <div className="mt-3 space-y-3">
      {ipAnalysis.map((ip, i) => (
        <div
          key={ip.endereco || i}
          data-report-block
          className="rounded-xl border border-surface-border bg-surface/30 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 shrink-0 text-primary" />
                <span className="break-all font-mono text-[13px] font-bold text-foreground">
                  {ip.endereco}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] text-zinc-500">
                IPv{ip.versao || "?"}
                {ip.porta ? ` · porta lógica ${ip.porta}` : ""}
                {" · "}
                {ip.rotulo
                  ? `registrado como “${ip.rotulo}”`
                  : "sem rótulo explícito no documento"}
              </p>
            </div>
          </div>

          <div className="mt-2.5">
            {ip.data_hora && <Row label="Data / hora do registro" value={ip.data_hora} />}
            {ip.user_agent && <Row label="Dispositivo declarado" value={ip.user_agent} />}

            {ip.geo ? (
              <>
                <Row
                  label="Origem da conexão"
                  value={[ip.geo.city, ip.geo.region, ip.geo.country].filter(Boolean).join(" / ")}
                />
                <Row
                  label="Coordenadas do IP"
                  value={`${ip.geo.lat}, ${ip.geo.lon}`}
                  mono
                />
                {ip.geo.isp && <Row label="Operadora (ISP)" value={ip.geo.isp} />}
                <Row label="Fonte da geolocalização" value={ip.geo.source} />
              </>
            ) : (
              /* Distinção essencial: o documento TRAZIA o endereço, a consulta
                 falhou. Tratar as duas ausências como iguais induz a erro. */
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.05] px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-[12.5px] leading-relaxed text-zinc-300">
                  Geolocalização não obtida ({ip.geoFailure || "motivo não registrado"}). O
                  endereço consta do documento; a ausência de coordenada decorre de falha na
                  consulta ao provedor, não de omissão do instrumento.
                </p>
              </div>
            )}
          </div>

          <Divergencia titulo="IP × residência informada" d={ip.divergenciaResidencia} />
          <Divergencia titulo="IP × GPS declarado no contrato" d={ip.divergenciaAssinatura} />

          {/* Confronto 1 — origem da conexão × residência. Só no primeiro IP
              geolocalizado: dossiês de trilha repetem o mesmo endereço em vários
              eventos, e um mapa por evento seria o mesmo mapa várias vezes. */}
          {i === 0 && ip.geo && homeGeo && ip.divergenciaResidencia && (
            <div className="mt-3">
              <GeoMap
                from={{ ...homeGeo, label: "R", color: "#3b82f6", titulo: "Residência informada" }}
                to={{
                  lat: ip.geo.lat,
                  lon: ip.geo.lon,
                  label: "I",
                  color: "#dc2626",
                  titulo: `Origem da conexão (${ip.geo.city || "localização do IP"})`,
                }}
                distanceKm={ip.divergenciaResidencia.km}
                riskColor={TONES[ip.divergenciaResidencia.tom]?.hex}
                legenda={
                  <>
                    <b className="text-foreground">Mapa 1 — origem da conexão × residência.</b>{" "}
                    <b className="text-primary">R</b> = residência informada ·{" "}
                    <b className="text-red-500">I</b> = origem da conexão pelo endereço IP. O ponto
                    I indica o ponto de presença da operadora, <b>não</b> a posição do aparelho —
                    a margem é de dezenas de quilômetros.
                  </>
                }
              />
            </div>
          )}
        </div>
      ))}

      <Note>
        Um endereço IP não carrega coordenada. A localização acima vem de base que mapeia
        blocos de IP ao ponto de presença da operadora — o roteador de saída, não o aparelho.
        Em rede móvel brasileira, com CGNAT e blocos IPv6 alocados por região, o ponto
        devolvido tende à capital ou ao centro de operação do estado. Divergências de dezenas
        de quilômetros são esperadas; o que tem valor indiciário é a incompatibilidade de
        ordem de grandeza.
      </Note>
    </div>
  );
}
