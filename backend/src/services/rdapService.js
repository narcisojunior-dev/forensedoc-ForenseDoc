/**
 * Serviço oficial de consulta RDAP (Registration Data Access Protocol)
 * Utiliza a infraestrutura pública e autoritativa do Registro.br / LACNIC.
 * Não requer chaves de API pagas e fornece dados oficiais de titularidade de blocos e ASN.
 */

const RDAP_TIMEOUT_MS = 6000;

export async function lookupRdapIp(ip) {
  if (!ip || typeof ip !== "string") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);

  try {
    const url = `https://rdap.registro.br/ip/${encodeURIComponent(ip.trim())}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/rdap+json, application/json",
        "User-Agent": "ForenseDoc-Forensic-Engine/3.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();

    // Extrair Entidade / Titular
    let ownerName = null;
    let ownerDocument = null;
    if (Array.isArray(data.entities)) {
      for (const ent of data.entities) {
        if (ent.vcardArray?.[1]) {
          for (const item of ent.vcardArray[1]) {
            if (item[0] === "fn") ownerName = item[3];
          }
        }
        if (ent.publicIds?.[0]?.identifier) {
          ownerDocument = ent.publicIds[0].identifier;
        }
        if (ownerName) break;
      }
    }

    // Extrair ASN e Faixas CIDR
    const autnums = Array.isArray(data.autnums) ? data.autnums : [];
    const asn = autnums.length > 0 ? `AS${autnums[0]}` : null;
    const handle = data.handle || null;
    const cidrs = Array.isArray(data.cidr0_cidrs)
      ? data.cidr0_cidrs.map((c) => `${c.v4prefix || c.v6prefix}/${c.length}`).join(", ")
      : null;

    return {
      asn,
      owner: ownerName,
      document: ownerDocument,
      handle,
      cidr: cidrs,
      source: "rdap.registro.br",
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
