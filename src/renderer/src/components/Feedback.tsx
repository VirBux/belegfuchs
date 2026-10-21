import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { dismissToast, resolveConfirm, useStore } from '../store';
import { Modal } from './ui';

const ICONS = { success: CircleCheck, warn: TriangleAlert, error: CircleX, info: Info };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon className="ic" />
            <div className="msg">{t.text}</div>
            {t.action && (
              <button
                className="act"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="close" onClick={() => dismissToast(t.id)} title="Schliessen">
              <X />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmDialog() {
  const c = useStore((s) => s.confirm);
  if (!c) return null;
  return (
    <Modal
      title={c.title}
      size="small"
      onClose={() => resolveConfirm('cancel')}
      footer={
        <>
          {c.extraLabel && (
            <button className="btn" onClick={() => resolveConfirm('extra')}>
              {c.extraLabel}
            </button>
          )}
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={() => resolveConfirm('cancel')}>
            {c.cancelLabel ?? 'Abbrechen'}
          </button>
          <button
            className="btn btn-primary"
            style={c.danger ? { background: 'var(--err)', borderColor: '#991b1b' } : undefined}
            onClick={() => resolveConfirm('confirm')}
            autoFocus
          >
            {c.confirmLabel}
          </button>
        </>
      }
    >
      <div className="modal-body" style={{ lineHeight: 1.5, color: 'var(--text-2)' }}>
        {c.text}
      </div>
    </Modal>
  );
}
