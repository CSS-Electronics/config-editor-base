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

The [config editor](https://github.com/CSS-Electronics/config-editor) can take a list of UIschema and Rule Schema files. This enables the editor to "auto-load" the UIschemas upon initial load, as well as "auto-load" the Rule Schema files matching the revision of the loaded Configuration File.

Note that the parsed list of files should match the actual files that are included in the config-editor-base `dist/` folder.

For example, the Rule Schema for `"schema-01.02.json | CANedge2"` should be contained in `dist/schema/CANedge2/schema-01.02.json`.

The syntax for parsing these lists is as below (in the [config-editor](https://github.com/CSS-Electronics/config-editor) repo `Editor.js` file):

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

Note that the code distinguishes between a `config-XX.YY.json` file loaded from a CANedge1 and CANedge2 unit. This is done by evaluating whether a `connect` section exists or not in the Configuration File. Based on this test, the editor either loads the Rule Schema for the CANedge2 (if `connect` exists) or the CANedge1.


---

## Parsing S3 functionality

The config editor also supports various S3 calls, e.g. for loading Rule Schema and Configuration Files from a device S3 folder - as well as submitting updated Configuration Files to S3. See the [CANcloud](https://github.com/CSS-Electronics/cancloud) repository for an example of this implementation.

---

## Regarding styling

The config editor relies on styling from the parent application. For examples of styling, see the CANedge configuration editor.

---

## Editor Base Tools

The module includes built-in tools for OBD configuration and filter building. These are exported as `OBDTool` and `FilterBuilderTool`.

### OBD Tool

Generates OBD-II transmit lists for CANedge devices. Key features:
- **PID Selection**: Select standard OBD-II PIDs from a built-in database
- **Supported PIDs Parser**: Parse response data to identify vehicle-supported PIDs
- **Control Signal**: Optional GPS-based speed control signal to prevent battery drain when vehicle is off
- **Transmit List Generation**: Outputs partial JSON for merging with device configuration

```jsx
import { OBDTool } from "config-editor-base";

// In editorTools array:
{
  name: "obd-modal",
  comment: "OBD tool",
  class: "fa fa-car",
  modal: <OBDTool showAlert={this.props.showAlert} />
}
```

### Filter Builder Tool

Analyzes CSV log files to help users create optimized CAN filters. Key features:
- **CSV Analysis**: Load mdf2csv output to see CAN ID distribution by size contribution
- **DBC Matching**: Match CAN IDs to DBC message names and signals
- **J1939 PGN Grouping**: Group 29-bit IDs by PGN for J1939/ISOBUS protocols
- **Filter Generation**: Generate acceptance filters with optional prescalers
- **Reset Filters**: Reset CAN channel filters to defaults (record everything)

```jsx
import { FilterBuilderTool } from "config-editor-base";

// In editorTools array:
{
  name: "filter-builder-modal",
  comment: "Filter builder",
  class: "fa fa-sliders",
  modal: <FilterBuilderTool showAlert={this.props.showAlert} deviceType="CANedge" />
}
```

The `deviceType` prop controls device-specific behavior:
- `"CANedge"` or `"CANedge2 GNSS"`: Standard CANedge filter structure
- `"CANmod"`: CANmod.router filter structure (requires `frame_format` field)

### Updating for New Firmware Revisions

When a new firmware revision is released (e.g., CANedge 01.10.XX), update these files:

#### 1. Supported Firmware Versions (`FilterBuilderTool.js`)
```javascript
// Add new version to the supported arrays at top of file:
const SUPPORTED_FIRMWARE_CANEDGE = ["01.08", "01.09", "01.10"];  // Add here
const SUPPORTED_FIRMWARE_CANMOD_ROUTER = ["01.02"];
```

#### 2. Default Filter Configs (`src/editorBaseTools/filterBuilder/`)
If the filter schema changes, create new default filter JSON files:
- `canedge-default-filters-XX.YY.json`
- `canedge-default-filters-gps-XX.YY.json`
- `canmod-router-default-filters-XX.YY.json`

Then update imports in `FilterBuilderTool.js` if structure changes.

#### 3. Control Signal Config (`src/editorBaseTools/obd/`)
If the control signal schema changes:
- Create `control-signal-internal-gps-XX.YY.json`
- Update import in `OBDTool.js`

#### 4. Schema Files (`dist/schema/`)
Add new schema and uischema files to the appropriate folders and update `schemaAry`/`uiSchemaAry` in `Editor.js`.

---

## Regarding JSON Schema files 

The module expects to find JSON Schema files in the structure below to facilitate auto-loading of these:

```
/
|-- dist/
	|-- schema/
		|-- Advanced/
			|-- uischema-XX.YY.json 
		|-- Simple/
			|-- uischema-XX.YY.json 
		|-- CANedge1/
			|-- schema-XX.YY.json 
		|-- CANedge2/
			|-- schema-XX.YY.json 		
```
