import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CameraOff } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { Sheet } from '../../ui/Sheet';
import { looksLikeReceipt, normalizeId, verifyPath } from './verifyUtil';

/* BarcodeDetector is not in the TypeScript DOM library yet: the part we use. */
interface DetectedCode {
  rawValue: string;
}
interface Detector {
  detect(source: CanvasImageSource): Promise<DetectedCode[]>;
}
type DetectorCtor = (new (opts?: { formats?: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> };

const detectorCtor = (): DetectorCtor | null => (typeof window !== 'undefined' ? ((window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null) : null);

/**
 * Can this browser scan a QR here? BarcodeDetector that reads QR codes, getUserMedia, and at least one camera.
 * (Desktop Chrome on Windows has no BarcodeDetector; Android Chrome has it.)
 */
export async function scanSupport(): Promise<boolean> {
  const Ctor = detectorCtor();
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formats.includes('qr_code')) return false;
    const devices = (await navigator.mediaDevices.enumerateDevices?.()) ?? [];
    return devices.length === 0 || devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

type ScanState = 'starting' | 'scanning' | 'found' | 'denied' | 'failed';

/**
 * The camera, in a sheet: point it at a receipt's QR and the verifier opens. Frames never leave the phone: the browser's
 * own BarcodeDetector reads them. The camera stops the moment the sheet closes.
 */
export function ScannerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t('vf.scan.title')} subtitle={t('vf.scan.sub')}>
      <ScannerBody onClose={onClose} />
    </Sheet>
  );
}

function ScannerBody({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>('starting');
  const [foreign, setForeign] = useState(false);

  useEffect(() => {
    const Ctor = detectorCtor();
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    let busy = false;
    if (!Ctor) {
      setState('failed');
      return;
    }
    const detector = new Ctor({ formats: ['qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!alive) return stream.getTracks().forEach((tr) => tr.stop());
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        setState('scanning');
        timer = window.setInterval(async () => {
          if (busy || !alive || v.readyState < 2) return;
          busy = true;
          try {
            const codes = await detector.detect(v);
            const hit = codes.find((c) => looksLikeReceipt(c.rawValue));
            if (hit && alive) {
              setState('found');
              window.clearInterval(timer);
              nav(verifyPath(normalizeId(hit.rawValue)));
              onClose();
            } else if (codes.length) setForeign(true);
          } catch {
            /* a frame that could not be read: try the next one */
          } finally {
            busy = false;
          }
        }, 220);
      } catch (e) {
        if (!alive) return;
        setState(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'failed');
      }
    })();
    return () => {
      alive = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [nav, onClose]);

  const message =
    state === 'denied' ? t('vf.scan.denied') : state === 'failed' ? t('vf.scan.failed') : state === 'found' ? t('vf.scan.found') : foreign ? t('vf.scan.foreign') : t('vf.scan.aim');

  return (
    <div className="grid gap-4">
      <div className="vf-cam" data-state={state}>
        {state === 'denied' || state === 'failed' ? (
          <div className="grid h-full place-items-center text-ink-3">
            <CameraOff size={40} strokeWidth={1.5} aria-hidden />
          </div>
        ) : (
          <>
            <video ref={video} playsInline muted />
            <span className="vf-cam-corners" aria-hidden />
            {state === 'scanning' && <span className="vf-cam-beam" aria-hidden />}
          </>
        )}
      </div>
      <p className="m-0 text-center text-sm text-ink-2" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
