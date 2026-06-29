type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

export type PdfPageText = {
  pageNumber: number;
  text: string;
};

export type PdfPageImage = {
  pageNumber: number;
  imageBase64: string;
  width: number;
  height: number;
};

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

type PdfTextItem = {
  str: string;
  hasEOL?: boolean;
};

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string"
  );
}

async function extractTextFromPage(page: {
  getTextContent: () => Promise<{ items: unknown[] }>;
}): Promise<string> {
  const content = await page.getTextContent();
  return content.items
    .flatMap((item) =>
      isTextItem(item) ? [`${item.str}${item.hasEOL ? "\n" : " "}`] : [],
    )
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function extractPdfPagesWithOcr(
  file: File,
  recognize: (page: PdfPageImage) => Promise<string>,
): Promise<PdfPageText[]> {
  const { getDocument } = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pages: PdfPageText[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      let text = await extractTextFromPage(page);

      if (!text) {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas недоступен для OCR PDF.");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const imageBase64 = canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
        text = (await recognize({
          pageNumber,
          imageBase64,
          width: canvas.width,
          height: canvas.height,
        })).trim();
        canvas.width = 1;
        canvas.height = 1;
      }

      if (text) pages.push({ pageNumber, text });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  if (!pages.length) {
    throw new Error(`OCR не нашёл текста в PDF «${file.name}».`);
  }
  return pages;
}
