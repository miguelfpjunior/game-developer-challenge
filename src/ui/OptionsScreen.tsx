import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { OPTION_LIMITS, type PlayerOptions } from '../game/config';
import { mockControls } from '../mocks/browser';
import { SCENARIOS, type ScenarioId } from '../mocks/scenarios';
import { type OptionErrors, validateOptions } from '../state/persistence';
import { Button, Panel, Screen } from './components';
import { navigate } from './router';

function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: string;
  hint: string;
  error?: string | undefined;
  children: (props: { id: string; 'aria-describedby': string; 'aria-invalid': boolean }) => React.ReactNode;
  id: string;
}) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': `${id}-hint ${id}-error`, 'aria-invalid': !!error })}
      <p id={`${id}-hint`} className="field__hint">
        {hint}
      </p>
      <p id={`${id}-error`} className="field__error" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>
    </div>
  );
}

export function OptionsScreen({ options, onSave }: { options: PlayerOptions; onSave: (o: PlayerOptions) => void }) {
  const uid = useId();
  const [session, setSession] = useState(String(options.sessionSeconds));
  const [spawn, setSpawn] = useState(String(options.spawnIntervalSeconds));
  const [name, setName] = useState(options.playerName);
  const [soundOn, setSoundOn] = useState(options.soundEnabled);
  const [errors, setErrors] = useState<OptionErrors>({});
  const [saved, setSaved] = useState(false);
  const s = OPTION_LIMITS.sessionSeconds;
  const sp = OPTION_LIMITS.spawnIntervalSeconds;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const candidate = {
      sessionSeconds: session.trim() === '' ? NaN : Number(session),
      spawnIntervalSeconds: spawn.trim() === '' ? NaN : Number(spawn),
      playerName: name,
    };
    const errs = validateOptions(candidate);
    setErrors(errs);
    setSaved(false);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    onSave({ ...candidate, playerName: candidate.playerName.trim(), soundEnabled: soundOn });
    setSaved(true);
  };

  return (
    <Screen className="screen--options">
      <Panel wide labelledBy="options-title">
        <h1 id="options-title" className="heading">
          Options
        </h1>
        <form className="options-form" onSubmit={submit} noValidate>
          <Field
            id={`${uid}-sessionSeconds`}
            label="Game session time (seconds)"
            hint={`${s.min}–${s.max} seconds of active play.`}
            error={errors.sessionSeconds}
          >
            {(p) => (
              <input
                {...p}
                type="number"
                inputMode="numeric"
                min={s.min}
                max={s.max}
                step={s.step}
                value={session}
                onChange={(e) => setSession(e.target.value)}
              />
            )}
          </Field>
          <Field
            id={`${uid}-spawnIntervalSeconds`}
            label="Enemy spawn time (seconds)"
            hint={`One enemy every ${sp.min}–${sp.max} s, in steps of ${sp.step} s.`}
            error={errors.spawnIntervalSeconds}
          >
            {(p) => (
              <input
                {...p}
                type="number"
                inputMode="decimal"
                min={sp.min}
                max={sp.max}
                step={sp.step}
                value={spawn}
                onChange={(e) => setSpawn(e.target.value)}
              />
            )}
          </Field>
          <Field id={`${uid}-playerName`} label="Captain name" hint="Shown in the ranking." error={errors.playerName}>
            {(p) => <input {...p} type="text" autoComplete="nickname" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="field field--inline">
            <input id={`${uid}-sound`} type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            <label htmlFor={`${uid}-sound`}>Sound effects</label>
          </div>
          <p className="status-line" role="status">
            {saved ? 'Options saved. They apply to your next match.' : ''}
          </p>
          <div className="row">
            <Button type="submit">Save</Button>
            <Button variant="secondary" onClick={() => navigate({ name: 'menu' })}>
              Main Menu
            </Button>
          </div>
        </form>
        <NetworkLab />
      </Panel>
    </Screen>
  );
}

/** Selects mocked network scenarios (ranking/history API) and restores the initial state. */
function NetworkLab() {
  const qc = useQueryClient();
  const [scenario, setScenario] = useState<ScenarioId>(mockControls.getScenario());
  const [message, setMessage] = useState('');
  const id = useId();

  return (
    <details className="network-lab">
      <summary>Network lab (mock API scenarios)</summary>
      <div className="field">
        <label htmlFor={id}>Scenario</label>
        <select
          id={id}
          value={scenario}
          onChange={(e) => {
            const next = e.target.value as ScenarioId;
            mockControls.setScenario(next);
            setScenario(next);
            setMessage(`Scenario set to “${SCENARIOS[next]}”.`);
            void qc.invalidateQueries();
          }}
        >
          {(Object.keys(SCENARIOS) as ScenarioId[]).map((k) => (
            <option key={k} value={k}>
              {k} — {SCENARIOS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <Button
          small
          variant="secondary"
          onClick={() => {
            mockControls.reset();
            setScenario('normal');
            qc.clear();
            setMessage('Mock server restored: fixtures reloaded and scenario reset to normal.');
          }}
        >
          Reset mock server
        </Button>
      </div>
      <p className="status-line" role="status">
        {message}
      </p>
    </details>
  );
}
