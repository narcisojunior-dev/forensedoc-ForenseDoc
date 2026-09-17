#!/usr/bin/env python3
"""Gera laudos PDF estáveis a partir das análises locais do ForenseDoc."""

from datetime import datetime
from html import escape
import json
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


HERE = Path(__file__).resolve().parent
INPUT = HERE / "results" / "forensedoc-reports"
OUTPUT = HERE / "results" / "forensedoc-reports-pdf"
NAVY = colors.HexColor("#10182A")
CYAN = colors.HexColor("#4FC3E8")
INK = colors.HexColor("#1A2233")
MUTED = colors.HexColor("#667085")
LINE = colors.HexColor("#D8DEE9")
PAPER = colors.HexColor("#F5F7FA")
WARN = colors.HexColor("#A46608")
CRIT = colors.HexColor("#A43131")


styles = getSampleStyleSheet()
TITLE = ParagraphStyle("title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=27, textColor=NAVY, alignment=TA_CENTER)
SUBTITLE = ParagraphStyle("subtitle", parent=styles["Normal"], fontSize=10, leading=14, textColor=MUTED, alignment=TA_CENTER)
HEADING = ParagraphStyle("heading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=NAVY, spaceBefore=8, spaceAfter=7)
BODY = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9.2, leading=13, textColor=INK, alignment=TA_JUSTIFY)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=7.8, leading=10.5, textColor=MUTED)
MONO = ParagraphStyle("mono", parent=SMALL, fontName="Courier", fontSize=7.2, leading=9.5, textColor=NAVY)
ALERT = ParagraphStyle("alert", parent=BODY, borderColor=WARN, borderWidth=0.7, borderPadding=8, backColor=colors.HexColor("#FFF6E6"), textColor=colors.HexColor("#704900"))


def value(data, *path, empty="Não localizado"):
    current = data
    for key in path:
        if not isinstance(current, dict):
            return empty
        current = current.get(key)
    if current is None or current == "" or current == []:
        return empty
    if isinstance(current, bool):
        return "Sim" if current else "Não"
    if isinstance(current, (list, tuple)):
        return " · ".join(str(item) for item in current if item)
    return str(current)


def para(text, style=BODY):
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), style)


def table(rows):
    data = [[para(label, SMALL), para(content, MONO if mono else BODY)] for label, content, mono in rows]
    result = Table(data, colWidths=[48 * mm, 119 * mm], repeatRows=0, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("BACKGROUND", (0, 0), (0, -1), PAPER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return result


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, A4[1] - 10 * mm, A4[0], 10 * mm, fill=1, stroke=0)
    canvas.setFillColor(CYAN)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(18 * mm, A4[1] - 6.5 * mm, "FORENSEDOC · LAUDO TÉCNICO")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 15 * mm, A4[0] - 18 * mm, 15 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Ronney Menezes Advocacia · análise automatizada sujeita a revisão profissional")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Página {doc.page}")
    canvas.restoreState()


def build(source):
    report = json.loads(source.read_text(encoding="utf-8"))
    extracted = report.get("extracted", {})
    metadata = report.get("metadata", {})
    signature = extracted.get("assinatura", {}) or {}
    crypto = signature.get("assinatura_criptografica", {}) or {}
    derived = metadata.get("metadataAnalysisStatus") == "NOT_ASSESSABLE_DERIVED"
    findings = extracted.get("achados_irregularidade", []) or []
    if derived:
        findings = [item for item in findings if not re.match(r"^(?:SIG|META)-|^INT2$", str(item.get("codigo") or ""), re.I)]
    warnings = metadata.get("warnings", []) or []
    target = OUTPUT / f"Laudo_ForenseDoc_{report['case']}.pdf"
    document = SimpleDocTemplate(
        str(target), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=20 * mm,
        title=f"Laudo ForenseDoc - {report['case']}", author="ForenseDoc",
    )
    story = [
        Spacer(1, 14 * mm),
        Paragraph("FORENSEDOC", TITLE),
        Paragraph("Laudo técnico de contrato eletrônico", SUBTITLE),
        Spacer(1, 8 * mm),
        table([
            ("Processo", report["case"], False),
            ("Documento PJe", report.get("sourceDocumentId") or "Não informado", False),
            ("Tipo reconhecido", report.get("sourceDocumentType") or "Não informado", False),
            ("Arquivo examinado", Path(report["sourceContract"]).name, False),
            ("SHA-256", report["sha256"], True),
            ("Tamanho", f"{report['sizeBytes']:,} bytes", False),
            ("OCR", f"{'Aplicado' if report['usedOcr'] else 'Não necessário'} · {report['ocrPages']} página(s)", False),
            ("Emissão", datetime.fromisoformat(report["generatedAt"].replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M"), False),
        ]),
        Spacer(1, 7 * mm),
        Paragraph("ESCOPO E ESTADO DO DOCUMENTO", HEADING),
        Paragraph(
            (
                "Este laudo examina o conteúdo textual, a trilha declarada, as imagens e a coerência interna do documento bancário selecionado. O arquivo é um recorte derivado do caderno PJe; por isso, metadados nativos, data de criação e assinatura criptográfica não são aferíveis neste exemplar."
                if derived else
                "Este laudo examina o arquivo eletrônico apresentado quanto a estrutura PDF, metadados, assinatura incorporada, trilha declarada, coerência interna e elementos técnicos localizados. A ausência de elemento no arquivo apresentado não demonstra, isoladamente, fraude ou inexistência de contratação."
            ),
            BODY,
        ),
        Spacer(1, 4 * mm),
        Paragraph("PENDENTE DE REVISÃO HUMANA · NÃO LIBERADO PARA PROTOCOLO", ALERT),
        PageBreak(),
        Paragraph("1. Identificação extraída", HEADING),
        table([
            ("Contratante", value(extracted, "cliente", "nome"), False),
            ("CPF", value(extracted, "cliente", "cpf"), False),
            ("Instituição", value(extracted, "contrato", "instituicao"), False),
            ("Número do contrato", value(extracted, "contrato", "numero"), False),
            ("Data declarada", value(extracted, "contrato", "data_contrato"), False),
            ("Valor", value(extracted, "contrato", "valor_contratado"), False),
            ("Valor liberado", value(extracted, "contrato", "valor_liberado"), False),
            ("Parcelamento", value(extracted, "contrato", "numero_parcelas"), False),
        ]),
        Spacer(1, 5 * mm),
        Paragraph("2. Integridade e metadados", HEADING),
        table([
            ("Estado da aferição", value(metadata, "metadataAnalysisStatus"), False),
            ("Procedência", value(metadata, "sourceProvenance", "kind"), False),
            ("Versão PDF", "Não aferível no arquivo nativo" if derived else value(metadata, "version"), False),
            ("Produtor", "Não aferível no arquivo nativo" if derived else value(metadata, "producer"), False),
            ("Criador", "Não aferível no arquivo nativo" if derived else value(metadata, "creator"), False),
            ("Data de criação", "Não aferível no arquivo nativo" if derived else value(metadata, "creationDate"), False),
            ("Data de modificação", "Não aferível no arquivo nativo" if derived else value(metadata, "modificationDate"), False),
            ("Assinaturas incorporadas", "Não aferível no arquivo nativo" if derived else value(metadata, "hasEmbeddedSignatures"), False),
            ("Estado criptográfico", value(metadata, "cryptographicSignatureStatus"), False),
        ]),
        Spacer(1, 5 * mm),
        Paragraph("3. Assinatura e trilha declarada", HEADING),
        table([
            ("Tipo de assinatura", value(signature, "tipo"), False),
            ("Data e hora", value(signature, "data_hora_assinatura"), False),
            ("Estado criptográfico", value(crypto, "estado"), False),
            ("Quantidade", value(crypto, "quantidade"), False),
            ("Procedência", value(crypto, "procedencia", "procedencia"), False),
            ("Motivo técnico", value(crypto, "motivo"), False),
            ("IP", value(extracted, "ips"), False),
            ("Geolocalização", value(extracted, "geolocalizacao_assinatura"), False),
        ]),
        PageBreak(),
        Paragraph("4. Achados técnicos", HEADING),
    ]
    if findings:
        for index, finding in enumerate(findings, start=1):
            story.append(Paragraph(
                f"<b>{index}. {escape(str(finding.get('titulo') or finding.get('codigo') or 'Achado'))}</b> "
                f"[{escape(str(finding.get('gravidade') or 'A CONFERIR'))}]",
                BODY,
            ))
            story.append(para(finding.get("texto") or finding.get("detalhe") or "Sem descrição adicional.", BODY))
            story.append(Spacer(1, 3 * mm))
    else:
        story.append(para("Nenhum achado automático de irregularidade foi produzido. Isso não equivale à confirmação de validade do contrato.", BODY))

    story.append(Paragraph("5. Advertências de metadados", HEADING))
    if warnings:
        for item in warnings:
            story.append(Paragraph(f"• {escape(str(item))}", BODY))
            story.append(Spacer(1, 1.5 * mm))
    else:
        story.append(para("Nenhuma advertência adicional foi produzida pelos metadados.", BODY))

    story.extend([
        Spacer(1, 5 * mm),
        Paragraph("6. Limitações e providência", HEADING),
        Paragraph(
            "A conclusão jurídica pertence ao advogado responsável. Hash declarado, IP, geolocalização, biometria e imagens devem ser confrontados com o arquivo nativo da contratação, registros do emissor, documentos pessoais e narrativa processual. Enquanto o arquivo nativo não for exibido, a ausência de assinatura digital ou de metadados não pode ser afirmada; cabe requerer sua exibição na forma dos arts. 396 e 400 do CPC. Este laudo somente acompanha a réplica após conferência visual e jurídica.",
            BODY,
        ),
    ])
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return target


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    generated = []
    manifest = []
    for source in sorted(INPUT.glob("*.json")):
        if source.name == "manifest.json":
            continue
        report = json.loads(source.read_text(encoding="utf-8"))
        selection = report.get("sourceSelection", {}) or {}
        if selection.get("linkStatus") != "demonstrated":
            manifest.append({
                "source": str(source),
                "case": report.get("case"),
                "status": "skipped-no-case-link",
                "sourceContract": report.get("sourceContract"),
                "reason": "O documento bancário selecionado não demonstrou vínculo com estes autos. O laudo não foi emitido para não periciar documento que pode não pertencer ao contrato discutido.",
            })
            continue
        if report.get("sourceSelection", {}).get("eligible") is not True or report.get("eligibility", {}).get("allowed") is not True:
            manifest.append({"source": str(source), "status": "quarantined-ineligible"})
            continue
        generated.append(build(source))
        manifest.append({"source": str(source), "status": "generated-preliminary", "output": str(generated[-1])})
        print(generated[-1])
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
