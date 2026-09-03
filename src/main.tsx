import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanningShell } from '@/src/components/planning-shell';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlanningShell />
  </StrictMode>,
);
