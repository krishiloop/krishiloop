import { Camera, Image as ImageIcon, Leaf, Send } from 'lucide-react';
import { MAX_PHOTOS, type ViewRequest } from './report';
import { ViewArt } from './ViewArt';
import { useI18n, type Key } from '../../../lib/i18n';
import { pickText } from '../../../lib/format';

/**
 * The next photo to ask for: ONE specific view, a small picture of it and a one-line reason, instead of "take more
 * photos". It names the diseases the photo would tell apart (their rows are marked above), because that is what makes
 * the ask worth a farmer's time. A pack supplies the wording; the generic ask (another leaf) comes from the app strings.
 */
export function ViewRequestCard({
  view,
  taken,
  sample,
  canAdd,
  hasCase,
  onTake,
  onGallery,
  onSample,
  onOfficer,
}: {
  view: ViewRequest;
  /** photos already taken */
  taken: number;
  sample: boolean;
  canAdd: boolean;
  hasCase: boolean;
  onTake: () => void;
  onGallery: () => void;
  onSample: () => void;
  onOfficer: () => void;
}) {
  const { t, lang } = useI18n();
  const title = view.title ? pickText(view.title, lang) : { text: t(`photo.view.${view.id}.title` as Key), lang };
  const reason = view.reason ? pickText(view.reason, lang) : { text: t(`photo.view.${view.id}.reason` as Key), lang };
  return (
    <section className="view" aria-labelledby="view-t" data-testid="photo-view-request" data-view={view.id}>
      <ViewArt art={view.art} className="view-art" />
      <div className="view-body">
        <p className="eyebrow !text-sun m-0">{t('photo.view.next', { n: taken + 1, max: MAX_PHOTOS })}</p>
        <h3 id="view-t" className="view-title" lang={title.lang}>
          {title.text}
        </h3>
        <p className="view-reason" lang={reason.lang}>
          {reason.text}
        </p>
        <div className="view-actions">
          <button type="button" className="btn btn-primary" disabled={!canAdd} onClick={onTake} data-testid="photo-more">
            <Camera size={17} aria-hidden /> {t('photo.view.take')}
          </button>
          {sample ? (
            <button type="button" className="btn btn-ghost" disabled={!canAdd} onClick={onSample} data-testid="photo-sample-view">
              <Leaf size={16} aria-hidden /> {t('photo.sample.useView')}
            </button>
          ) : (
            <button type="button" className="btn btn-quiet btn-sm" disabled={!canAdd} onClick={onGallery} data-testid="photo-more-gallery">
              <ImageIcon size={15} aria-hidden /> {t('photo.more.gallery')}
            </button>
          )}
          {!hasCase ? (
            <button type="button" className="btn btn-quiet btn-sm" onClick={onOfficer} data-testid="photo-send">
              <Send size={14} aria-hidden /> {t('photo.view.officer')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
