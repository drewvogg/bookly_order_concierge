import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReturnLabelMetadata } from "@/lib/repositories/booklyRepository";

const returnCenterAddress = "Bookly Returns Center, 410 Demo Park Way, Joliet, IL 60435";

export async function generateReturnLabelPdf(label: ReturnLabelMetadata) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 396]);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({
    x: 28,
    y: 28,
    width: 556,
    height: 340,
    borderColor: rgb(0.08, 0.1, 0.14),
    borderWidth: 2
  });

  page.drawText("Bookly Demo Return Label", {
    x: 48,
    y: 330,
    size: 22,
    font: bold,
    color: rgb(0.08, 0.1, 0.14)
  });

  page.drawText("DEMO LABEL - NOT VALID FOR SHIPPING", {
    x: 48,
    y: 305,
    size: 11,
    font: bold,
    color: rgb(0.72, 0.12, 0.12)
  });

  const rows = [
    ["Label ID", label.labelId],
    ["Order ID", label.orderId],
    ["Item", label.itemTitle],
    ["SKU", label.itemSku],
    ["Return reason", label.returnReason],
    ["Customer", label.customerName],
    ["From", label.customerReturnAddress],
    ["To", returnCenterAddress],
    ["Expires", label.expiresAt]
  ];

  let y = 270;
  for (const [key, value] of rows) {
    page.drawText(`${key}:`, { x: 48, y, size: 10, font: bold, color: rgb(0.22, 0.25, 0.3) });
    page.drawText(value, { x: 150, y, size: 10, font: regular, color: rgb(0.08, 0.1, 0.14) });
    y -= 24;
  }

  page.drawRectangle({
    x: 430,
    y: 78,
    width: 116,
    height: 70,
    borderColor: rgb(0.08, 0.1, 0.14),
    borderWidth: 1
  });
  page.drawText("BOOKLY", { x: 454, y: 122, size: 14, font: bold, color: rgb(0.08, 0.1, 0.14) });
  page.drawText(label.labelId, { x: 452, y: 100, size: 12, font: regular, color: rgb(0.08, 0.1, 0.14) });

  return pdfDoc.save();
}
