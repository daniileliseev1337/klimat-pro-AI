import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import OAuthConsentPage from './components/OAuthConsentPage.jsx';
import './index.css';

const Root = window.location.pathname === '/oauth/consent' ? OAuthConsentPage : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
