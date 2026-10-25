import DOMPurify from 'dompurify';
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { MAX_TEMPLATE_BYTES, MAX_TEMPLATE_SIZE_LABEL } from './template-limits.js';

// Convert only on the administrator's device. Store a PDF so participant
// downloads reuse the vector PDF path, rather than a screenshot of the SVG.
export async function svgTemplateToPdf(source) {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg'
    || parsed.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('This file is not a valid SVG.');
  }
  if (parsed.querySelector('script, foreignObject, animate, animateMotion, animateTransform, set, filter')) {
    throw new Error('Use a static SVG without scripts, animation, HTML, or filters. For complex effects, upload the original PDF.');
  }
  const clean = DOMPurify.sanitize(source, { USE_PROFILES: { svg: true } });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('Could not read the SVG artwork.');
  // Keep the SVG detached from the live page, and permit local references and
  // embedded PNG/JPEG artwork only. Nothing may fetch an external resource.
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of element.attributes) {
      if (attribute.localName === 'href' && !/^#[\w:.-]+$/.test(attribute.value)
        && !/^data:image\/(png|jpeg);base64,[a-z\d+/=\s]+$/i.test(attribute.value)) {
        throw new Error('Embed images in the SVG instead of linking to external files.');
      }
    }
    const css = [element.getAttribute('style') || '',
      element.localName === 'style' ? element.textContent : '',
      ...Array.from(element.attributes, attribute => attribute.value).filter(value => /url\s*\(/i.test(value))].join(' ');
    if (/[\\@]/.test(css) || [...css.matchAll(/url\s*\(([^)]*)\)/gi)].some(match =>
      !/^#[\w:.-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, '')))) {
      throw new Error('SVG styles must use local artwork only; external URLs and fonts are not supported.');
    }
  }
  if (!svg.hasAttribute('viewBox')) {
    const width = parseFloat(svg.getAttribute('width'));
    const height = parseFloat(svg.getAttribute('height'));
    if (!(width > 0 && height > 0)) throw new Error('Export the SVG with a viewBox or explicit width and height.');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  await svg2pdf(svg, pdf, { x: 0, y: 0, width, height, loadExternalStyleSheets: false });
  if (pdf.output('arraybuffer').byteLength > MAX_TEMPLATE_BYTES) {
    throw new Error(`The converted SVG is larger than ${MAX_TEMPLATE_SIZE_LABEL}. Simplify the artwork or upload a smaller PDF.`);
  }
  return pdf.output('datauristring');
}
