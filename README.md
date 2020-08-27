# Config Editor - Base Module

This project includes a React based JSON Schema editor.

[![NPM](https://img.shields.io/npm/v/config-editor-base.svg)](https://www.npmjs.com/package/config-editor-base) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save config-editor-base
```

## Usage

The module uses redux, hence you'll need to import the base module and the `reducer` as follows:


The index.js connects the store and parses the App 

```jsx
// index.js

import React from 'react'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'

import configureStore from './store/configure-store'
import App from './App'

const store = configureStore()

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
)
```

To set up the store, it is necessary to load the editor reducer from the module 

```jsx 
// reducers.js 

import { combineReducers } from "redux";
import alert from "./alert/reducer";

import editor from 'config-editor-base/src/editorBase/reducer'


const rootReducer = combineReducers({
  alert,
  editor,
});

export default rootReducer;

```
In the App we can load an Editor module, which can be constructed as below:

```jsx 
import React from "react";
import { connect } from "react-redux";

import {EncryptionModal} from "config-editor-tools";

import {EditorSection} from "config-editor-base";

import * as actionsAlert from "../alert/actions";
import AlertContainer from "../alert/AlertContainer";

class Editor extends React.Component {
  render() {
    let editorTools = [
      {
        name: "encryption-modal",
        comment: "Encryption tool",
        class: "fa fa-lock",
        modal: <EncryptionModal showAlert={this.props.showAlert} />,
      }
    ];

    return (
      <React.Fragment>
        <AlertContainer />
        <EditorSection
          editorTools={editorTools}
          showAlert={this.props.showAlert}
        />
      </React.Fragment>
    );
  }
}

const mapDispatchToProps = (dispatch) => {
  return {
    showAlert: (type, message) =>
      dispatch(actionsAlert.set({ type: type, message: message })),
  };
};

export default connect(null, mapDispatchToProps)(Editor);

```
