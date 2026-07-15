import EditorSection from './editorBase/EditorSection'
import editor from './editorBase/reducer'
import * as editorActions from './editorBase/actions'
import OBDTool from './editorBaseTools/OBDTool'
import FilterBuilderTool from './editorBaseTools/FilterBuilderTool'
import { computeConfigDelta } from './editorBase/configDelta'
// loadFile resolves an embedded dist schema/uischema by "name | DeviceType"
// (e.g. "schema-01.09.json | CANedge2 GNSS"). Exported so tools such as the
// migration tool can load the official dist schema for a target revision.
import { loadFile } from './editorBase/utils'

export {
  EditorSection,
  editor,
  editorActions,
  OBDTool,
  FilterBuilderTool,
  computeConfigDelta,
  loadFile
}
