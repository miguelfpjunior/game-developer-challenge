import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from 'react';
import { sound } from '../game/audio';
import { ACTION_LABELS, type InputAction, KEY_BINDINGS, keyLabel, PAUSE_KEYS } from '../game/input';

export function Panel({ children, wide, labelledBy }: { children: ReactNode; wide?: boolean; labelledBy?: string }) {
  return (
    <section className={`panel${wide ? ' panel--wide' : ''}`} aria-labelledby={labelledBy}>
      <div className="panel__content">{children}</div>
    </section>
  );
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={`screen ${className ?? ''}`}>{children}</main>;
}

type Variant = 'primary' | 'secondary';

export function Button({
  variant = 'primary',
  small,
  className,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  return (
    <button
      type="button"
      className={`btn btn--${variant}${small ? ' btn--small' : ''} ${className ?? ''}`}
      onClick={(e) => {
        sound.play('ui_click', 0.6);
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

export function RoundButton({
  icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button type="button" className={`round-btn ${className ?? ''}`} aria-label={label} title={label} {...rest}>
      <span className={`icon icon--${icon}`} aria-hidden="true" />
    </button>
  );
}

/** Modal dialog with focus trap, Escape handling and focus restore. */
export function Dialog({
  title,
  children,
  onEscape,
  id,
}: {
  title: string;
  children: ReactNode;
  onEscape?: () => void;
  id: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, [tabindex="0"]') ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener('keydown', onKey);
    return () => {
      node?.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [onEscape]);

  return (
    <div className="dialog-backdrop">
      <div ref={ref} className="panel dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="panel__content">
          <h2 id={`${id}-title`} className="heading">
            {title}
          </h2>
          {children}
        </div>
      </div>
    </div>
  );
}

const ORDER: InputAction[] = ['forward', 'turnLeft', 'turnRight', 'fireFront', 'fireLeft', 'fireRight'];

export function ControlsHelp({ compact }: { compact?: boolean }) {
  return (
    <div className={`controls-help${compact ? ' controls-help--compact' : ''}`}>
      <h2 className="subheading">Controls</h2>
      <dl>
        {ORDER.map((a) => (
          <div key={a} className="controls-help__row">
            <dt>{ACTION_LABELS[a]}</dt>
            <dd>
              {KEY_BINDINGS[a].map((k) => (
                <kbd key={k}>{keyLabel(k === 'Space' ? 'Space' : k)}</kbd>
              ))}
            </dd>
          </div>
        ))}
        <div className="controls-help__row">
          <dt>Pause / resume</dt>
          <dd>
            {PAUSE_KEYS.map((k) => (
              <kbd key={k}>{keyLabel(k === 'Escape' ? 'Esc' : k)}</kbd>
            ))}
          </dd>
        </div>
      </dl>
      <p className="hint">On touch screens use the on-screen buttons (landscape). You can sail and fire at the same time.</p>
    </div>
  );
}
