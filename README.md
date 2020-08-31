# Config Editor - Base Module

This project includes a React based JSON Schema editor.

[![NPM](https://img.shields.io/npm/v/config-editor-base.svg)](https://www.npmjs.com/package/config-editor-base) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

### Installation

```bash
npm install --save config-editor-base
```

---

### Development testing

You can directly test the "raw" configuration editor by cloning this repository and running below `npm install` in root and in the `example/` folder. After this, run `npm start` in the root as well as in the `example/` folder.

---

### Publishing a new package via npm

To publish your own custom version as an npm package, you can modify the `package.json` and run `npm publish`. You'll need to be logged in first.

---

### Usage in a parent app

The module uses redux, hence you'll need to import the base module and the `reducer` as follows:

```jsx
// reducers.js

import { combineReducers } from 'redux'
import alert from './alert/reducer'

import { editor } from 'config-editor-base'

const rootReducer = combineReducers({
  alert,
  editor
})

export default rootReducer
```

In the parent App we can load an Editor module, which can be constructed as below:

```jsx
import React from 'react'
import { connect } from 'react-redux'

import { EncryptionModal } from 'config-editor-tools'
import { EditorSection } from 'config-editor-base'

import * as actionsAlert from '../alert/actions'
import AlertContainer from '../alert/AlertContainer'

class Editor extends React.Component {
  render() {
    let editorTools = [
      {
        name: 'encryption-modal',
        comment: 'Encryption tool',
        class: 'fa fa-lock',
        modal: <EncryptionModal showAlert={this.props.showAlert} />
      }
    ]

    return (
      <div className='file-explorer'>
        <div className='fe-body fe-body-offline'>
          <AlertContainer />
          <EditorSection
            editorTools={editorTools}
            showAlert={this.props.showAlert}
          />
        </div>
      </div>
    )
  }
}

const mapDispatchToProps = (dispatch) => {
  return {
    showAlert: (type, message) =>
      dispatch(actionsAlert.set({ type: type, message: message }))
  }
}

export default connect(null, mapDispatchToProps)(Editor)
```

---

## Parsing embedded Rule Schema and UISchema files

The config editor can take a list of UIschema and Rule Schema files. This enables the editor to "auto-load" the UIschemas upon initial load, as well as "auto-load" the Rule Schema files matching the revision of the loaded Configuration File.

Note that the parsed list of files should match the actual files that are included in the config-editor-base `dist/` folder.

For example, the Rule Schema for `"schema-01.02.json | CANedge2"` should be contained in `dist/schema/CANedge2/schema-01.02.json`.

The syntax for parsing these lists is as below:

```jsx

// define UIschema and Rule Schema names for auto-loading embedded schema files
export const uiSchemaAry = [
  "uischema-01.02.json | Simple",
  "uischema-01.02.json | Advanced",
];

export const schemaAry = [
  "schema-01.02.json | CANedge2",
  "schema-01.02.json | CANedge1",
  "schema-00.07.json | CANedge2",
  "schema-00.07.json | CANedge1",
];

...

<EditorSection
  editorTools={editorTools}
  showAlert={this.props.showAlert}
  uiSchemaAry={uiSchemaAry}
  schemaAry={schemaAry}
/>
...

```

---

## Parsing S3 functionality

The config editor also supports various S3 calls, e.g. for loading Rule Schema and Configuration Files from a device S3 folder - as well as submitting updated Configuration Files to S3. See the [CANcloud](https://github.com/CSS-Electronics/cancloud) repository for an example of this implementation.

---

## Regarding styling

The config editor relies on styling from the parent application. For examples of styling, see the CANedge configuration editor.
