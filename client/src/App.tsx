import type { AlertState } from '@m1/shared';

// Phase 0 scaffold: proves the @m1/shared type import resolves and typechecks.
export function App() {
  const initialState: AlertState = 'IDLE';
  return (
    <main>
      <h1>M1 Figyelő</h1>
      <p>Road Hazard Alert POC — scaffold ready. Engine state: {initialState}</p>
    </main>
  );
}
