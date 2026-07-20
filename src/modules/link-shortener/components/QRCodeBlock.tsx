import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Loader2 } from 'lucide-react';

interface Props {
  url: string;
  filename?: string;
}

const COLORS = [
  { name: 'Indigo', dark: '#4f46e5' },
  { name: 'Black', dark: '#0f172a' },
  { name: 'Pink', dark: '#db2777' },
  { name: 'Emerald', dark: '#059669' },
];

export default function QRCodeBlock({ url, filename = 'qr-code' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState<string>(COLORS[0].dark);
  const [renderingSvg, setRenderingSvg] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 224,
      color: { dark: color, light: '#ffffff' },
    }).catch(() => undefined);
  }, [url, color]);

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  async function downloadSvg() {
    setRenderingSvg(true);
    try {
      const svg = await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 1,
        color: { dark: color, light: '#ffffff' },
      });
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const link = document.createElement('a');
      link.download = `${filename}.svg`;
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } finally {
      setRenderingSvg(false);
    }
  }

  return (
    <div className="rounded-card border border-edge bg-surface p-5 flex flex-col items-center gap-4">
      <canvas ref={canvasRef} className="rounded-control" />
      <div className="flex items-center gap-2">
        {COLORS.map((c) => (
          <button
            key={c.name}
            onClick={() => setColor(c.dark)}
            title={c.name}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c.dark ? 'border-slate-700 scale-110' : 'border-edge'}`}
            style={{ backgroundColor: c.dark }}
          />
        ))}
      </div>
      <div className="flex gap-2 w-full">
        <button onClick={downloadPng} className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-control bg-brand-600 hover:bg-brand-700 text-brand-fg text-sm font-medium">
          <Download className="w-4 h-4" /> PNG
        </button>
        <button
          onClick={downloadSvg}
          disabled={renderingSvg}
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-control bg-surface-sunken hover:bg-edge text-content text-sm font-medium disabled:opacity-50"
        >
          {renderingSvg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} SVG
        </button>
      </div>
      <p className="text-xs text-content-secondary text-center break-all">{url}</p>
    </div>
  );
}
