import './requireShim'

import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import configureStore from './store/configure-store'
import App from './App'

import "./index.css";

const store = configureStore()

// No <StrictMode>: the editor relies on UNSAFE_ lifecycles and a per-render
// remount of the rjsf form (see config-editor-base EditorSection).
createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <App />
  </Provider>
)
