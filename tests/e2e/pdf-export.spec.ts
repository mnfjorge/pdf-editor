import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Simple happy-path E2E: mock upload API to return a public PDF URL, add text overlay, export, verify download
test('PDF upload, overlay, and export produces a downloaded file', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`pageerror: ${err.message}`));
  // Instrument page to capture blob exports and filename
  await page.addInitScript(() => {
    (window as any).__exportedBlobs = [] as Blob[];
    (window as any).__lastDownloadName = null as string | null;
    (window as any).__lastAlert = null as string | null;
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((obj: any) => {
      try {
        if (obj && typeof obj === 'object' && 'type' in obj) {
          (window as any).__exportedBlobs.push(obj as Blob);
        }
      } catch {}
      return originalCreateObjectURL(obj);
    }) as typeof URL.createObjectURL;
    const originalAnchorClick = (HTMLAnchorElement.prototype as any).click;
    (HTMLAnchorElement.prototype as any).click = function(this: HTMLAnchorElement) {
      try { (window as any).__lastDownloadName = this.download || null; } catch {}
      return originalAnchorClick.call(this);
    };
    const originalAlert = window.alert.bind(window);
    window.alert = (msg?: any) => { try { (window as any).__lastAlert = String(msg ?? ''); } catch {}; return originalAlert(msg); };
  });

  await page.goto('/');

  // Intercept upload API and fulfill with a known public PDF URL
  const fakePdfPath = '/fake.pdf';
  await page.route('**/api/upload', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: fakePdfPath }),
    });
  });

  // Serve a minimal valid PDF for the subsequent fetch
  await page.route('**/fake.pdf', async route => {
    const pdfDoc = await PDFDocument.create();
    const page1 = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const { width, height } = page1.getSize();
    page1.drawText('Test PDF', { x: 72, y: height - 72, size: 24, font, color: rgb(0, 0, 0) });
    const bytes = await pdfDoc.save();
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(bytes) });
  });

  // Locate the upload label which contains the hidden input
  const fileInput = page.locator('input[type="file"][accept="application/pdf"]').first();

  // Provide any dummy local file; the route is mocked so server returns our sample URL
  const dummyBuffer = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  await fileInput.setInputFiles({ name: 'dummy.pdf', mimeType: 'application/pdf', buffer: dummyBuffer });

  // Wait for rendering to complete: canvases appear
  await page.getByText('Rendering PDF…').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 });

  // Click "Add text" on the first page toolbar
  await page.getByRole('button', { name: 'Add text' }).first().click();

  // The overlay input should appear; type into it to change text
  const overlayInput = page.locator('input.bg-transparent');
  await overlayInput.first().click();
  await overlayInput.first().fill('Hello Playwright');

  // Trigger export
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  await page.getByRole('button', { name: 'Export PDF' }).click();

  // Wait for either blob creation or alert
  await page.waitForFunction(() => {
    const blobs = (window as any).__exportedBlobs as Blob[] | undefined;
    const alertMsg = (window as any).__lastAlert as string | null;
    const hasBlob = Array.isArray(blobs) && blobs.length > 0;
    return hasBlob || !!alertMsg;
  }, undefined, { timeout: 30000 });

  // Validate success and collect debug info if failed
  const result = await page.evaluate(async () => {
    const blobs = (window as any).__exportedBlobs as Blob[];
    const last = blobs[blobs.length - 1];
    const alertMsg = (window as any).__lastAlert as string | null;
    if (!last) {
      return { ok: false, reason: alertMsg || 'no-blob', size: 0, type: '', name: (window as any).__lastDownloadName };
    }
    const size = await last.arrayBuffer().then(b => b.byteLength);
    return { ok: true, reason: null, size, type: last.type, name: (window as any).__lastDownloadName };
  });
  expect(result.ok, `Export failed: ${result.reason}\nLogs: ${logs.join('\n')}`).toBe(true);
  expect(result.size).toBeGreaterThan(100);
  expect(result.name).toContain('.pdf');
});

