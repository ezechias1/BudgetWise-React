import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

// Vanilla CSS — copied byte-for-byte from the original BudgetWise project.
// These files define every class used by the ported components, so the
// React app is visually identical to the vanilla app by construction.
import './styles-auth.css';
import './styles-dashboard.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
