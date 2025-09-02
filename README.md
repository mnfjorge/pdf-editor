## PDF Uploader & Overlay Editor

This app lets users upload a single PDF to Vercel Blob, add draggable text overlays on each page, and export the modified PDF with text burned in.

### Setup

1. Copy environment example and set your Blob token:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and set `BLOB_READ_WRITE_TOKEN`.

Generate a token in Vercel: `Storage` → `Blob` → `Tokens`.

2. Install dependencies and run dev server:

```bash
pnpm install
pnpm dev
```

3. Open `http://localhost:3000`.

### How it works

- Upload API: `POST /api/upload` uses `@vercel/blob` to store the PDF publicly.
- Viewer: `pdfjs-dist` renders PDF pages to `<canvas>` elements.
- Overlays: Draggable inputs positioned relative to the page (normalized coordinates).
- Export: `pdf-lib` writes text onto the PDF pages and triggers a download.
