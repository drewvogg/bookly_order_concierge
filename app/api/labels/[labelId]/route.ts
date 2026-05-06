import { NextResponse } from "next/server";
import { generateReturnLabelPdf } from "@/lib/pdf/generateReturnLabel";
import { booklyRepository } from "@/lib/repositories/booklyRepository";

export async function GET(_request: Request, context: { params: Promise<{ labelId: string }> }) {
  try {
    const { labelId } = await context.params;
    const label = booklyRepository.getReturnLabel(labelId);

    if (!label) {
      return NextResponse.json({ error: "Return label not found. Demo labels are stored in memory." }, { status: 404 });
    }

    const pdfBytes = await generateReturnLabelPdf(label);
    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${label.labelId}.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("[bookly-labels] failed to render return label PDF", error);
    return NextResponse.json({ error: "Unable to render the return label PDF." }, { status: 500 });
  }
}
